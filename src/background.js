import {
  MAX_ACTIVATION_RECOVERY_ATTEMPTS,
  MAX_ACTIVE_WORKFLOWS,
  MAX_RECENT_RESULTS,
  MAX_RELIABLE_PAIRS,
  RELIABLE_ALARM_NAME,
  RELIABLE_LEDGER_KEY,
  STATE_KEY,
  STORY_REPORT_PATH,
  SUCCESSFACTORS_HOST_SUFFIXES,
  createEmptyReliableLedger,
  isSupportedReportCenterUrl,
  isSafeResumeAttemptId,
  isSameWorkflow,
  makeCookieExceptionPair,
  makeActivationRecoveryAttempt,
  makeLastStatus,
  makeRecentResult,
  makeReliableLedgerEntry,
  parseIasUrl,
  parseSuccessFactorsOrigin,
  pruneReliableLedger,
  pruneSessionState
} from "./core.js";

const RELIABLE_RETRY_MS = 60_000;
const CONTENT_SETTINGS_PERMISSION = Object.freeze({ permissions: ["contentSettings"] });
const LEGACY_RELIABLE_CONTROL_KEY = "sapIasReliableModeControl.v1";
const SF_ACTIVATION_BUILD_KEY = "sapStoryAccessActivationBuild.v1";
const SF_ACTIVATION_BUILD = "1.1.1";
const SF_ACTIVATION_PROTOCOL = 1;
const SF_ACTIVATION_PROBE_TIMEOUT_MS = 750;
const POPUP_STATUS_TIMEOUT_MS = 750;
const POPUP_STATUS_SNAPSHOT_STALE_MS = 2_000;
const MAX_PUBLIC_STATUS_SNAPSHOTS = 2;
const DIRECT_RESUME_TIMEOUT_MS = 5_000;
const MANUAL_FIX_COOLDOWN_MS = 30_000;
const MANUAL_RELOAD_DELAY_MS = 1_200;
const SF_ACTIVE_REPORT_CENTER_QUERY_PATTERNS = Object.freeze(
  SUCCESSFACTORS_HOST_SUFFIXES.map(
    (suffix) => `https://*.${suffix.slice(1)}${STORY_REPORT_PATH}*`
  )
);

let stateQueue = Promise.resolve();
let reliableQueue = Promise.resolve();
let publicStatusSnapshotPromise = null;
let publicStatusSnapshotStale = false;
const publicStatusSnapshotsInFlight = new Set();

// Invoke this before registering listeners or starting any asynchronous ledger work.
// storage.local is otherwise readable by content scripts in Chromium.
const localLedgerAccessPromise = protectLocalLedger();
const startupActivationScanDecisionPromise = recordActivationBuildAndDecideStartupScan();
const initializationPromise = initializeBackground().catch(() => undefined);
const startupRecoveryPromise = initializationPromise.then(resumePreparedWorkflows).catch(() => undefined);
// A service worker can be started by re-enabling or updating the extension,
// without an install event or a tab activation. Inspect the one active page so
// a Report Center document that predates this worker can receive the sentinel.
// A version transition skips this scan because session state was cleared and
// an old exact-document continuation could still be in flight. The install
// event retains its explicit scan, while same-build worker starts are safe.
void Promise.all([startupRecoveryPromise, startupActivationScanDecisionPromise])
  .then(([, shouldScan]) => shouldScan ? evaluateActiveReportCenterTabs() : undefined)
  .catch(() => undefined);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // A preparing startup recovery needs its exact document to cross the commit
  // barrier before recovery itself can finish.
  const dispatchPromise = message?.type === "get-status"
    // The popup is a read-only, sender-restricted status surface. It must not
    // wait behind cold-worker allowance reconciliation or a resumed SAP
    // continuation. Any in-flight durable write is reflected by a later poll.
    ? Promise.resolve().then(() => dispatchMessage(message, sender))
    : message?.type === "replay-schedule-ready"
      ? initializationPromise.then(() => dispatchMessage(message, sender))
      : startupRecoveryPromise.then(() => dispatchMessage(message, sender));
  dispatchPromise
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      const code = error instanceof ReliableModeError ? error.code : "error";
      sendResponse({ ok: false, code });
    });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeSessionRecordsForClosedTab(tabId);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (!Number.isInteger(tabId) || tabId <= 0) return;
  void startupRecoveryPromise.then(() => evaluateReportCenterTabById(tabId)).catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!Number.isInteger(tabId) || tabId <= 0 || !changeInfo || typeof changeInfo !== "object") return;
  if (!Object.hasOwn(changeInfo, "url") && changeInfo.status !== "complete") return;
  void startupRecoveryPromise.then(() => evaluateReportCenterTabById(tabId)).catch(() => undefined);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== RELIABLE_ALARM_NAME) return;
  void reconcileAutomaticAllowances().catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  void reconcileAutomaticAllowances().catch(() => undefined);
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details?.reason !== "install") return;
  void startupRecoveryPromise.then(evaluateActiveReportCenterTabs).catch(() => undefined);
});

async function initializeBackground() {
  await mutateState(() => undefined);
  try {
    await removeLegacyPauseMarker();
  } catch {
    // The legacy marker is no longer consulted. A failed best-effort deletion
    // must not stop normal allowance expiry and startup reconciliation.
  }
  try {
    await reconcileAutomaticAllowances();
  } catch {
    // Automatic mode fails closed. Exact interstitials are tombstoned instead
    // of retrying without an effective exact-pair rule.
  }

  const state = await readStateAfterPendingWrites();
  for (const snapshot of state.workflows) {
    if (snapshot.status !== "direct-preparing") await retireInterruptedDirect(snapshot);
  }
  await refreshBadge();
}

async function resumePreparedWorkflows() {
  const state = await readStateAfterPendingWrites();
  for (const snapshot of state.workflows) {
    if (snapshot.status === "direct-preparing") await executeDirectWorkflow(snapshot);
  }
}

async function retireInterruptedDirect(workflow) {
  await finalizeDirectWorkflow(workflow, "resume-interrupted");
}

async function evaluateActiveReportCenterTabs() {
  if (!isCurrentActivationBuild()) return;
  let tabs;
  try {
    tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
      url: SF_ACTIVE_REPORT_CENTER_QUERY_PATTERNS
    });
  } catch {
    return;
  }
  if (!Array.isArray(tabs)) return;
  for (const tab of tabs) await evaluateReportCenterTabForRecovery(tab);
}

async function evaluateReportCenterTabById(tabId) {
  if (!isCurrentActivationBuild()) return;
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }
  await evaluateReportCenterTabForRecovery(tab);
}

async function evaluateReportCenterTabForRecovery(tab) {
  if (!isSafeReportCenterTab(tab)) return;
  const state = await readStateAfterPendingWrites();
  const pendingAttempt = state.activationAttempts.find(
    (attempt) =>
      attempt.tabId === tab.id &&
      attempt.version === SF_ACTIVATION_BUILD &&
      attempt.phase === "reload-pending"
  );
  if (pendingAttempt) {
    // If the one-shot page-start handoff was lost, a later genuine activation
    // may recover it by proving the exact current sentinel. The durable marker
    // remains and this branch can never issue a second reload.
    if (!await isFocusedNormalWindow(tab.windowId)) return;
    const sentinel = await probeStoryActivationSentinel(tab.id);
    if (!isCurrentStoryActivationSentinel(sentinel)) return;
    await coverPendingActivationAfterProbe(tab.id);
    return;
  }
  if (
    state.activationAttempts.length >= MAX_ACTIVATION_RECOVERY_ATTEMPTS ||
    hasTabRecoveryBlocker(state, tab.id, SF_ACTIVATION_BUILD)
  ) return;

  // `tab.active` means active within its own window. Recovery is intentionally
  // limited to the user's focused normal window and never brings a background
  // window forward on the extension's behalf.
  if (!await isFocusedNormalWindow(tab.windowId)) return;
  const sentinel = await probeStoryActivationSentinel(tab.id);
  if (isCurrentStoryActivationSentinel(sentinel)) return;
  await claimAndReloadStoryTab(tab.id);
}

async function coverPendingActivationAfterProbe(tabId) {
  return withReliableLock(async () => {
    await requireProtectedLocalStorage();

    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return false;
    }
    if (!isSafeReportCenterTab(tab) || !await isFocusedNormalWindow(tab.windowId)) return false;

    const result = await markActivationReloadAttempted(tabId);
    return result.code === "sf-activation-ready";
  });
}

async function claimAndReloadStoryTab(tabId) {
  return withReliableLock(async () => {
    await requireProtectedLocalStorage();

    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return false;
    }
    if (!isSafeReportCenterTab(tab)) return false;
    if (!await isFocusedNormalWindow(tab.windowId)) return false;

    const claimed = await mutateState((state) => {
      if (hasTabRecoveryBlocker(state, tabId, SF_ACTIVATION_BUILD)) return false;
      if (state.activationAttempts.length >= MAX_ACTIVATION_RECOVERY_ATTEMPTS) return false;
      const attempt = makeActivationRecoveryAttempt(tabId, SF_ACTIVATION_BUILD);
      if (!attempt) return false;
      state.activationAttempts.push(attempt);
      state.lastStatus = makeLastStatus("page-refreshing");
      return true;
    });
    if (!claimed) return false;

    // The tab can navigate and focus can move while the write-ahead claim is
    // being persisted. Re-read both immediately before the side effect so an
    // unrelated page or now-background window is never reloaded.
    let finalTab;
    try {
      finalTab = await chrome.tabs.get(tabId);
    } catch {
      await removeActivationAttempt(tabId, SF_ACTIVATION_BUILD);
      return false;
    }
    if (
      !isSafeReportCenterTab(finalTab) ||
      finalTab.windowId !== tab.windowId ||
      !await isFocusedNormalWindow(finalTab.windowId)
    ) {
      await removeActivationAttempt(tabId, SF_ACTIVATION_BUILD);
      return false;
    }

    try {
      const reloadPromise = chrome.tabs.reload(tabId, { bypassCache: false });
      await reloadPromise;
    } catch {
      // The write-ahead attempt remains authoritative after an ambiguous reload.
    }
    return true;
  });
}

async function probeStoryActivationSentinel(tabId) {
  let timer;
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(
        tabId,
        {
          type: "sf-activation-probe",
          build: SF_ACTIVATION_BUILD,
          protocol: SF_ACTIVATION_PROTOCOL
        },
        { frameId: 0 }
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), SF_ACTIVATION_PROBE_TIMEOUT_MS);
      })
    ]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isCurrentStoryActivationSentinel(value) {
  return Boolean(
    value &&
    hasExactKeys(value, ["build", "protocol", "type"]) &&
    value.type === "sf-activation-current" &&
    value.build === SF_ACTIVATION_BUILD &&
    value.protocol === SF_ACTIVATION_PROTOCOL
  );
}

function isSafeReportCenterTab(tab) {
  return Boolean(
    tab &&
    Number.isInteger(tab.id) &&
    tab.id > 0 &&
    tab.active === true &&
    ["loading", "complete"].includes(tab.status) &&
    tab.incognito === false &&
    tab.discarded !== true &&
    tab.frozen !== true &&
    !tab.pendingUrl &&
    isSupportedReportCenterUrl(tab.url)
  );
}

async function isFocusedNormalWindow(windowId) {
  if (!Number.isInteger(windowId) || windowId < 0) return false;
  try {
    const browserWindow = await chrome.windows.get(windowId);
    return Boolean(
      browserWindow &&
      browserWindow.id === windowId &&
      browserWindow.focused === true &&
      browserWindow.incognito !== true &&
      browserWindow.type === "normal"
    );
  } catch {
    return false;
  }
}

async function isLastFocusedNormalWindow(windowId) {
  if (!Number.isInteger(windowId) || windowId < 0) return false;
  try {
    const browserWindow = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    return Boolean(
      browserWindow &&
      browserWindow.id === windowId &&
      browserWindow.incognito !== true &&
      browserWindow.type === "normal"
    );
  } catch {
    return false;
  }
}

function hasTabRecoveryBlocker(state, tabId, version) {
  return (
    state.workflows.some((workflow) => workflow.sourceTabId === tabId) ||
    state.recent.some((result) => result.sourceTabId === tabId) ||
    state.activationAttempts.some((attempt) => attempt.tabId === tabId && attempt.version === version)
  );
}

function isCurrentActivationBuild() {
  return chrome.runtime.getManifest().version === SF_ACTIVATION_BUILD;
}

async function dispatchMessage(message, sender) {
  if (!message || typeof message !== "object" || typeof message.type !== "string") return { code: "ignored" };
  if (sender.id !== chrome.runtime.id) return { code: "ignored" };
  if (message.type === "get-status" && hasExactKeys(message, ["type"])) {
    if (!isTrustedPopupSender(sender)) return { code: "ignored" };
    return getPublicStatus();
  }
  if (message.type === "force-fix-current-tab" && hasExactKeys(message, ["type"])) {
    if (!isTrustedPopupSender(sender)) return { code: "ignored" };
    return handleForceFixCurrentTab();
  }
  if (
    message.type === "sf-activation-ready" &&
    hasExactKeys(message, ["build", "protocol", "type"])
  ) {
    return handleStoryActivationReady(message, sender);
  }
  if (message.type === "interstitial-detected" && hasExactKeys(message, ["sourceOrigin", "type"])) {
    return handleInterstitialDetected(message, sender);
  }
  if (
    message.type === "replay-schedule-ready" &&
    hasExactKeys(message, ["resumeAttemptId", "type"])
  ) {
    return handleReplayScheduleReady(message, sender);
  }
  return { code: "ignored" };
}

async function handleStoryActivationReady(message, sender) {
  if (
    message.build !== SF_ACTIVATION_BUILD ||
    message.protocol !== SF_ACTIVATION_PROTOCOL ||
    !isExactStoryActivationSender(sender)
  ) return { code: "ignored" };

  let currentTab;
  try {
    currentTab = await chrome.tabs.get(sender.tab.id);
  } catch {
    return { code: "ignored" };
  }
  if (!isSameCurrentStoryDocument(sender, currentTab)) return { code: "ignored" };

  return withReliableLock(async () => {
    await requireProtectedLocalStorage();
    return markActivationReloadAttempted(sender.tab.id);
  });
}

function markActivationReloadAttempted(tabId) {
  return mutateState((state) => {
    const attempt = state.activationAttempts.find(
      (entry) =>
        entry.tabId === tabId &&
        entry.version === SF_ACTIVATION_BUILD &&
        entry.phase === "reload-pending"
    );
    if (!attempt) return { code: "ignored" };
    attempt.phase = "reload-attempted";
    state.lastStatus = makeLastStatus("page-prepared");
    return { code: "sf-activation-ready" };
  });
}

function isExactStoryActivationSender(sender) {
  return Boolean(
    sender?.tab &&
    Number.isInteger(sender.tab.id) &&
    sender.tab.id > 0 &&
    Number.isInteger(sender.tab.windowId) &&
    sender.tab.windowId >= 0 &&
    sender.tab.incognito !== true &&
    sender.frameId === 0 &&
    isSafeSourceDocumentId(sender.documentId) &&
    isSupportedReportCenterUrl(sender.url)
  );
}

function isSameCurrentStoryDocument(sender, tab) {
  if (
    !tab ||
    tab.id !== sender.tab.id ||
    tab.windowId !== sender.tab.windowId ||
    tab.active !== true ||
    !["loading", "complete"].includes(tab.status) ||
    tab.incognito !== false ||
    tab.discarded === true ||
    tab.frozen === true ||
    tab.pendingUrl ||
    !isSupportedReportCenterUrl(tab.url)
  ) return false;
  try {
    return new URL(sender.url).origin === new URL(tab.url).origin;
  } catch {
    return false;
  }
}

async function handleReplayScheduleReady(message, sender) {
  if (!isSafeResumeAttemptId(message.resumeAttemptId) || !isExactSourceDocumentSender(sender)) {
    return { code: "ignored" };
  }
  const iasOrigin = parseIasUrl(sender.url)?.origin;
  if (!iasOrigin) return { code: "ignored" };

  let newlyCommitted = false;
  const result = await withReliableLock(async () => {
    await requireProtectedLocalStorage();
    return mutateState((state) => {
      const workflow = state.workflows.find(
        (entry) =>
          entry.sourceTabId === sender.tab.id &&
          entry.sourceWindowId === sender.tab.windowId &&
          entry.sourceFrameId === sender.frameId &&
          entry.sourceDocumentId === sender.documentId &&
          entry.iasOrigin === iasOrigin &&
          entry.resumeAttemptId === message.resumeAttemptId &&
          entry.mode === "direct" &&
          entry.status === "direct-resuming"
      );
      if (workflow) {
        if (!appendRecentResult(state, workflow, "replay-scheduled")) {
          return { code: "error" };
        }
        state.workflows = state.workflows.filter((entry) => entry !== workflow);
        newlyCommitted = true;
        return {
          code: "replay-schedule-committed",
          resumeAttemptId: message.resumeAttemptId
        };
      }

      const committed = state.recent.some((entry) =>
        isMatchingReplaySchedule(entry, {
          sourceTabId: sender.tab.id,
          sourceWindowId: sender.tab.windowId,
          sourceFrameId: sender.frameId,
          sourceDocumentId: sender.documentId,
          iasOrigin,
          resumeAttemptId: message.resumeAttemptId
        })
      );
      return committed
        ? { code: "replay-schedule-committed", resumeAttemptId: message.resumeAttemptId }
        : { code: "ignored" };
    });
  });

  // Badge rendering is deliberately outside the durable commit barrier. A UI
  // failure must never withhold the commit ACK and tempt a second submission.
  if (newlyCommitted) void refreshBadge().catch(() => undefined);
  return result;
}

function isExactSourceDocumentSender(sender) {
  return Boolean(
    sender?.tab &&
    Number.isInteger(sender.tab.id) &&
    Number.isInteger(sender.tab.windowId) &&
    sender.tab.windowId >= 0 &&
    sender.tab.incognito !== true &&
    Number.isInteger(sender.frameId) &&
    sender.frameId > 0 &&
    isSafeSourceDocumentId(sender.documentId) &&
    parseIasUrl(sender.url)
  );
}

async function handleInterstitialDetected(message, sender) {
  if (!sender.tab || !Number.isInteger(sender.tab.id) || !Number.isInteger(sender.tab.windowId)) {
    return { code: "ignored" };
  }
  if (sender.tab.incognito) {
    await setLastStatus("incognito-not-supported");
    return { code: "incognito-not-supported" };
  }
  if (!Number.isInteger(sender.frameId) || sender.frameId <= 0 || !isSafeSourceDocumentId(sender.documentId)) {
    return { code: "ignored" };
  }

  const iasUrl = parseIasUrl(sender.url);
  const sourceOrigin = parseSuccessFactorsOrigin(message.sourceOrigin);
  if (!iasUrl || !sourceOrigin) return { code: "ignored" };
  const iasOrigin = iasUrl.origin;

  const result = await mutateState((state) => {
    if (
      state.activationAttempts.some(
        (attempt) =>
          attempt.tabId === sender.tab.id &&
          attempt.version === SF_ACTIVATION_BUILD &&
          ["reload-scheduled", "reload-pending"].includes(attempt.phase)
      )
    ) {
      state.lastStatus = makeLastStatus("continuation-in-progress");
      return { code: "continuation-in-progress" };
    }

    const duplicateResult = state.recent.find(
      (entry) =>
        entry.sourceTabId === sender.tab.id &&
        entry.sourceDocumentId === sender.documentId &&
        entry.iasOrigin === iasOrigin
    );
    if (duplicateResult) return { code: "already-handled" };

    const continuationInProgress = state.workflows.find(
      (workflow) => workflow.sourceTabId === sender.tab.id
    );
    if (continuationInProgress) {
      state.lastStatus = makeLastStatus("continuation-in-progress");
      return { code: "continuation-in-progress" };
    }

    const priorResume = state.recent.find(
      (entry) =>
        entry.sourceTabId === sender.tab.id &&
        entry.iasOrigin === iasOrigin &&
        ["replay-scheduled", "automatic-fix-blocked", "resume-interrupted"].includes(
          entry.outcome
        )
    );
    if (priorResume) {
      state.lastStatus = makeLastStatus(priorResume.outcome);
      return { code: priorResume.outcome };
    }

    if (state.workflows.length >= MAX_ACTIVE_WORKFLOWS) {
      state.lastStatus = makeLastStatus("limit-reached");
      return { code: "limit-reached" };
    }

    const workflow = {
      mode: "direct",
      sourceTabId: sender.tab.id,
      sourceWindowId: sender.tab.windowId,
      sourceFrameId: sender.frameId,
      sourceDocumentId: sender.documentId,
      iasOrigin,
      sourceOrigin,
      createdAt: Date.now(),
      status: "direct-preparing"
    };
    state.workflows.push(workflow);
    state.lastStatus = makeLastStatus("continuation-in-progress");
    return { code: "direct-claimed", workflow: { ...workflow } };
  });

  await refreshBadge();
  if (result.code !== "direct-claimed") return result;
  return executeDirectWorkflow(result.workflow);
}

async function executeDirectWorkflow(snapshot) {
  const workflow = await findDirectWorkflow(snapshot, true);
  if (!workflow || workflow.status !== "direct-preparing") return { code: "continuation-in-progress" };

  try {
    await ensureReliablePair(workflow.iasOrigin, workflow.sourceOrigin);
  } catch {
    return blockAutomaticWorkflow(workflow);
  }

  const claimed = await mutateState((state) => {
    const current = findMatchingDirect(state, workflow);
    if (!current || current.status !== "direct-preparing") return null;
    const resumeAttemptId = allocateResumeAttemptId(state);
    if (!resumeAttemptId) {
      state.workflows = state.workflows.filter((entry) => entry !== current);
      appendRecentResult(state, current, "resume-interrupted");
      return { code: "resume-interrupted" };
    }
    current.status = "direct-resuming";
    current.resumeRequestedAt = Date.now();
    current.resumeAttemptId = resumeAttemptId;
    state.lastStatus = makeLastStatus("continuation-in-progress");
    return { ...current };
  });
  if (!claimed) return { code: "continuation-in-progress" };
  if (claimed.code === "resume-interrupted") {
    await refreshBadge();
    return claimed;
  }
  let response;
  try {
    response = await requestExactDocumentResume(claimed);
  } catch {
    // The content document must durably commit replay scheduling before it can
    // submit. A lost or hung outer response is therefore safe to resolve from
    // the ledger. Without that durable evidence, tombstone the exact attempt:
    // never retry an ambiguous continuation that might still answer late.
    if (await hasReplayScheduled(claimed)) {
      await focusSourceTab(claimed);
      return { code: "replay-scheduled" };
    }
    await focusSourceTab(claimed);
    await finalizeDirectWorkflow(claimed, "resume-interrupted");
    return { code: "resume-interrupted" };
  }

  if (await hasReplayScheduled(claimed)) {
    await focusSourceTab(claimed);
    return { code: "replay-scheduled" };
  }
  if (!hasExpectedOrigins(response, claimed)) {
    await focusSourceTab(claimed);
    await finalizeDirectWorkflow(claimed, "resume-interrupted");
    return { code: "resume-interrupted" };
  }
  if (response.ready === false && response.code === "source-changed") {
    await finalizeDirectWorkflow(claimed, "source-changed");
    return { code: "source-changed" };
  }
  if (
    response.ready === true &&
    response.replaySubmitted === false &&
    response.code === "cookie-exception-not-active"
  ) {
    return blockAutomaticWorkflow(claimed);
  }
  if (
    response.ready === true &&
    response.replayScheduled === true &&
    response.code === "replay-scheduled"
  ) {
    await focusSourceTab(claimed);
    await finalizeDirectWorkflow(claimed, "resume-interrupted");
    return { code: "resume-interrupted" };
  }

  await focusSourceTab(claimed);
  await finalizeDirectWorkflow(claimed, "resume-interrupted");
  return { code: "resume-interrupted" };
}

function requestExactDocumentResume(workflow) {
  // Chromium message channels can remain pending after a document or worker
  // lifecycle change. Keep the startup recovery chain bounded while consuming
  // every late resolution/rejection. Late documents still face the independent
  // durable commit barrier and cannot submit after this attempt is tombstoned.
  const request = Promise.resolve().then(() => chrome.tabs.sendMessage(
    workflow.sourceTabId,
    { type: "resume-with-cookie-exception", resumeAttemptId: workflow.resumeAttemptId },
    { documentId: workflow.sourceDocumentId }
  ));

  return new Promise((resolve, reject) => {
    let pending = true;
    const timeoutId = setTimeout(() => {
      if (!pending) return;
      pending = false;
      reject(new Error("direct-resume-timeout"));
    }, DIRECT_RESUME_TIMEOUT_MS);

    request.then(
      (response) => {
        if (!pending) return;
        pending = false;
        clearTimeout(timeoutId);
        resolve(response);
      },
      (error) => {
        if (!pending) return;
        pending = false;
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

async function blockAutomaticWorkflow(snapshot) {
  await finalizeDirectWorkflow(snapshot, "automatic-fix-blocked");
  return { code: "automatic-fix-blocked" };
}

function hasExpectedOrigins(response, workflow) {
  return Boolean(
    response &&
    response.iasOrigin === workflow.iasOrigin &&
    response.sourceOrigin === workflow.sourceOrigin
  );
}

async function focusSourceTab(workflow) {
  try {
    await chrome.tabs.update(workflow.sourceTabId, { active: true });
    await focusWindow(workflow.sourceWindowId);
  } catch {
    // Exact-document continuation is already claimed; focus is best effort only.
  }
}

async function finalizeDirectWorkflow(snapshot, outcome) {
  await mutateState((state) => {
    const workflow = findMatchingDirect(state, snapshot);
    if (!workflow) return;
    state.workflows = state.workflows.filter((entry) => entry !== workflow);
    appendRecentResult(state, workflow, outcome);
  });
  await refreshBadge();
}

function appendRecentResult(state, workflow, outcome) {
  state.recent.push(makeRecentResult(workflow, outcome));
  state.recent = state.recent.slice(-MAX_RECENT_RESULTS);
  state.lastStatus = makeLastStatus(outcome);
  return true;
}

async function hasReplayScheduled(workflow) {
  if (!isSafeResumeAttemptId(workflow.resumeAttemptId)) return false;
  const state = await readStateAfterPendingWrites();
  return state.recent.some((entry) => isMatchingReplaySchedule(entry, workflow));
}

function isMatchingReplaySchedule(entry, workflow) {
  return (
    entry.outcome === "replay-scheduled" &&
    entry.resumeAttemptId === workflow.resumeAttemptId &&
    entry.sourceTabId === workflow.sourceTabId &&
    entry.sourceWindowId === workflow.sourceWindowId &&
    entry.sourceFrameId === workflow.sourceFrameId &&
    entry.sourceDocumentId === workflow.sourceDocumentId &&
    entry.iasOrigin === workflow.iasOrigin &&
    (workflow.sourceOrigin === undefined || entry.sourceOrigin === workflow.sourceOrigin)
  );
}

function allocateResumeAttemptId(state) {
  if (typeof globalThis.crypto?.randomUUID !== "function") return null;
  const existing = new Set([
    ...state.workflows.map((workflow) => workflow.resumeAttemptId).filter(isSafeResumeAttemptId),
    ...state.recent.map((entry) => entry.resumeAttemptId).filter(isSafeResumeAttemptId)
  ]);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = globalThis.crypto.randomUUID();
    if (isSafeResumeAttemptId(candidate) && !existing.has(candidate)) return candidate;
  }
  return null;
}

async function removeSessionRecordsForClosedTab(sourceTabId) {
  const removed = await mutateState((state) => {
    const hadWorkflow = state.workflows.some((entry) => entry.sourceTabId === sourceTabId);
    const hadAttempt = state.activationAttempts.some((entry) => entry.tabId === sourceTabId);
    state.workflows = state.workflows.filter((entry) => entry.sourceTabId !== sourceTabId);
    state.activationAttempts = state.activationAttempts.filter((entry) => entry.tabId !== sourceTabId);
    return hadWorkflow || hadAttempt;
  });
  if (removed) await refreshBadge();
}

async function removeActivationAttempt(tabId, version) {
  await mutateState((state) => {
    state.activationAttempts = state.activationAttempts.filter(
      (attempt) => attempt.tabId !== tabId || attempt.version !== version
    );
  });
}

async function findDirectWorkflow(snapshot, waitForPendingWrites = false) {
  const state = waitForPendingWrites ? await readStateAfterPendingWrites() : await readState();
  const workflow = findMatchingDirect(state, snapshot);
  return workflow ? { ...workflow } : null;
}

function findMatchingDirect(state, snapshot) {
  return state.workflows.find(
    (entry) => entry.mode === "direct" && isSameWorkflow(
      entry,
      snapshot.sourceTabId,
      snapshot.sourceFrameId,
      snapshot.sourceDocumentId,
      snapshot.iasOrigin,
      snapshot.sourceOrigin
    )
  );
}

async function ensureReliablePair(iasOrigin, sourceOrigin) {
  return withReliableLock(async () => {
    await requireProtectedLocalStorage();
    if (!await hasReliablePermission()) {
      throw new ReliableModeError("reliable-mode-permission-missing");
    }

    const now = Date.now();
    const current = await readReliableLedger(now);
    const candidate = makeReliableLedgerEntry(iasOrigin, sourceOrigin, now);
    if (!candidate) throw new ReliableModeError("reliable-mode-invalid-pair");
    const matching = current.entries.find(
      (value) => value.iasOrigin === candidate.iasOrigin && value.sourceOrigin === candidate.sourceOrigin
    );
    if (!matching && current.entries.length >= MAX_RELIABLE_PAIRS) {
      throw new ReliableModeError("reliable-mode-pair-limit");
    }
    // A repeat use never rolls the lease forward. Once this hard TTL expires,
    // a later exact detection may create a new one-hour allowance.
    const entry = matching || candidate;

    const next = pruneReliableLedger(
      {
        ...createEmptyReliableLedger(),
        entries: matching ? current.entries : [...current.entries, entry]
      },
      now
    );
    if (!next.entries.some(
      (value) => value.iasOrigin === entry.iasOrigin && value.sourceOrigin === entry.sourceOrigin
    )) {
      throw new ReliableModeError("reliable-mode-pair-limit");
    }

    await writeReliableLedger(next);
    try {
      await setReliableRetryAlarm(next);
    } catch {
      await writeReliableLedger(current);
      await scheduleReliableExpiry(current);
      throw new ReliableModeError("reliable-mode-alarm-failed");
    }

    await applyReliableLedger(next);
    const pair = makeCookieExceptionPair(entry.iasOrigin, entry.sourceOrigin);
    const effective = await getEffectiveCookieSetting(pair);
    if (effective?.setting !== "allow") {
      throw new ReliableModeError("reliable-mode-policy-not-effective");
    }
    await scheduleReliableExpiry(next);
    return entry;
  });
}

async function reconcileAutomaticAllowances() {
  try {
    return await withReliableLock(async () => {
      await requireProtectedLocalStorage();
      const permissionGranted = await hasReliablePermission();
      if (!permissionGranted) {
        await chrome.storage.local.remove(RELIABLE_LEDGER_KEY);
        await chrome.alarms.clear(RELIABLE_ALARM_NAME);
        return createEmptyReliableLedger();
      }

      const ledger = await readReliableLedger();
      await writeReliableLedger(ledger);
      await setReliableRetryAlarm(ledger);
      await applyReliableLedger(ledger);
      await scheduleReliableExpiry(ledger);
      return ledger;
    });
  } catch (error) {
    try {
      await setReliableRetryAlarm();
    } catch {
      // An exact detection still fails closed if reconciliation cannot be scheduled.
    }
    throw error;
  }
}

async function removeLegacyPauseMarker() {
  await requireProtectedLocalStorage();
  await chrome.storage.local.remove(LEGACY_RELIABLE_CONTROL_KEY);
}

async function readReliableLedger(now = Date.now()) {
  try {
    const stored = await chrome.storage.local.get(RELIABLE_LEDGER_KEY);
    return pruneReliableLedger(stored[RELIABLE_LEDGER_KEY], now);
  } catch {
    throw new ReliableModeError("reliable-mode-storage-unavailable");
  }
}

async function writeReliableLedger(ledger) {
  try {
    await chrome.storage.local.set({ [RELIABLE_LEDGER_KEY]: ledger });
  } catch {
    throw new ReliableModeError("reliable-mode-storage-unavailable");
  }
}

async function applyReliableLedger(ledger) {
  const cookies = chrome.contentSettings?.cookies;
  if (!cookies?.clear || !cookies?.set || !cookies?.get) {
    throw new ReliableModeError("reliable-mode-api-unavailable");
  }
  try {
    await cookies.clear({ scope: "regular" });
    for (const entry of ledger.entries) {
      await cookies.set({
        primaryPattern: entry.primaryPattern,
        secondaryPattern: entry.secondaryPattern,
        setting: "allow",
        scope: "regular"
      });
    }
  } catch {
    throw new ReliableModeError("reliable-mode-rule-apply-failed");
  }
}

async function getEffectiveCookieSetting(pair) {
  if (!pair || !chrome.contentSettings?.cookies?.get) {
    throw new ReliableModeError("reliable-mode-api-unavailable");
  }
  try {
    return await chrome.contentSettings.cookies.get({
      primaryUrl: pair.primaryUrl,
      secondaryUrl: pair.secondaryUrl,
      incognito: false
    });
  } catch {
    throw new ReliableModeError("reliable-mode-policy-check-failed");
  }
}

async function scheduleReliableExpiry(ledger) {
  if (!ledger.entries.length) {
    await chrome.alarms.clear(RELIABLE_ALARM_NAME);
    return;
  }
  const when = Math.min(...ledger.entries.map((entry) => entry.expiresAt));
  await chrome.alarms.create(RELIABLE_ALARM_NAME, { when });
}

async function setReliableRetryAlarm(ledger = null) {
  const retryAt = Date.now() + RELIABLE_RETRY_MS;
  const earliestExpiry = ledger?.entries?.length
    ? Math.min(...ledger.entries.map((entry) => entry.expiresAt))
    : retryAt;
  await chrome.alarms.create(RELIABLE_ALARM_NAME, { when: Math.min(retryAt, earliestExpiry) });
}

function withReliableLock(operation) {
  const task = reliableQueue.then(operation);
  reliableQueue = task.catch(() => undefined);
  return task;
}

function protectLocalLedger() {
  try {
    const setAccessLevel = chrome.storage.local?.setAccessLevel;
    if (typeof setAccessLevel !== "function") return Promise.resolve(false);
    return Promise.resolve(
      setAccessLevel.call(chrome.storage.local, { accessLevel: "TRUSTED_CONTEXTS" })
    ).then(() => true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

async function recordActivationBuildAndDecideStartupScan() {
  try {
    if (!await localLedgerAccessPromise) return false;
    const stored = await chrome.storage.local.get(SF_ACTIVATION_BUILD_KEY);
    const previousBuild = stored?.[SF_ACTIVATION_BUILD_KEY];
    await chrome.storage.local.set({ [SF_ACTIVATION_BUILD_KEY]: SF_ACTIVATION_BUILD });
    return previousBuild === SF_ACTIVATION_BUILD;
  } catch {
    // A missing durable decision fails closed. The exact install, activation,
    // and navigation listeners can still recover a later user-visible page.
    return false;
  }
}

async function requireProtectedLocalStorage() {
  if (!await localLedgerAccessPromise) {
    throw new ReliableModeError("reliable-mode-storage-unavailable");
  }
}

async function hasReliablePermission() {
  try {
    return await chrome.permissions.contains(CONTENT_SETTINGS_PERMISSION) === true;
  } catch {
    return false;
  }
}

function isTrustedPopupSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  const popupUrl = chrome.runtime.getURL("src/popup.html");
  if (sender.url !== popupUrl) return false;
  if (sender.tab === undefined) return true;
  return (
    sender.frameId === 0 &&
    sender.tab.incognito !== true &&
    sender.tab.url === popupUrl
  );
}

class ReliableModeError extends Error {
  constructor(code) {
    super(code);
    this.name = "ReliableModeError";
    this.code = code;
  }
}

async function setLastStatus(code) {
  await mutateState((state) => {
    state.lastStatus = makeLastStatus(code);
  });
}

async function getPublicStatus() {
  let timer;
  try {
    return await Promise.race([
      getSingleFlightPublicStatusSnapshot(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(makeUnavailablePublicStatus()), POPUP_STATUS_TIMEOUT_MS);
      })
    ]);
  } catch {
    return makeUnavailablePublicStatus();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function getSingleFlightPublicStatusSnapshot() {
  if (publicStatusSnapshotPromise && !publicStatusSnapshotStale) {
    return publicStatusSnapshotPromise;
  }
  // Browser API promises are not cancellable. Permit one fresh replacement
  // after a stalled snapshot, but retain a strict cap so a pathological API
  // cannot accumulate work while the popup keeps polling.
  if (publicStatusSnapshotPromise &&
      publicStatusSnapshotsInFlight.size >= MAX_PUBLIC_STATUS_SNAPSHOTS) {
    return publicStatusSnapshotPromise;
  }
  const snapshot = Promise.resolve().then(getPublicStatusSnapshot);
  publicStatusSnapshotPromise = snapshot;
  publicStatusSnapshotStale = false;
  publicStatusSnapshotsInFlight.add(snapshot);
  const staleTimer = setTimeout(() => {
    if (publicStatusSnapshotPromise === snapshot) {
      publicStatusSnapshotStale = true;
    }
  }, POPUP_STATUS_SNAPSHOT_STALE_MS);
  const clear = () => {
    clearTimeout(staleTimer);
    publicStatusSnapshotsInFlight.delete(snapshot);
    if (publicStatusSnapshotPromise === snapshot) {
      publicStatusSnapshotPromise = null;
      publicStatusSnapshotStale = false;
    }
  };
  // Handle both branches so a rejected snapshot cannot become unhandled after
  // all callers have already returned their bounded fail-soft status.
  void snapshot.then(clear, clear);
  return snapshot;
}

async function getPublicStatusSnapshot() {
  // A live popup intentionally reads the last durable snapshot instead of
  // waiting for stateQueue. If a write is in flight, the next non-overlapping
  // poll observes it without blocking the popup behind that mutation.
  const [context, state] = await Promise.all([
    getActiveReportCenterContext(),
    readState()
  ]);
  const allowance = context.tab && !hasImmediateStatusEvidence(state, context.tab.id)
    ? await assessActiveAllowanceForTab(context.tab)
    : { active: false, available: true };
  return makePublicStatus(state, context, allowance);
}

function makePublicStatus(state, context, allowance) {
  return {
    code: contextualStatusCode(state, context, allowance),
    activeCount: state.workflows.length,
    version: chrome.runtime.getManifest().version,
    canFixCurrentPage: canForceFixCurrentPage(state, context, allowance),
    currentPageState: context.pageState
  };
}

function makeUnavailablePublicStatus() {
  return {
    code: "check-unavailable",
    activeCount: 0,
    version: chrome.runtime.getManifest().version,
    canFixCurrentPage: false,
    currentPageState: "unavailable"
  };
}

async function handleForceFixCurrentTab() {
  let context;
  try {
    context = await getActiveReportCenterContext();
    if (context.pageState === "unavailable") {
      return makeManualResult("check-unavailable", context, false, 0);
    }
    if (!context.tab) return makeManualResult("wrong-page", context, false, 0);
    return await withReliableLock(async () => {
      await requireProtectedLocalStorage();

      let currentTab;
      try {
        currentTab = await chrome.tabs.get(context.tab.id);
      } catch {
        return makeManualResult("manual-fix-failed", context, false, 0);
      }
      if (!isSupportedReportCenterUrl(currentTab.url)) {
        return makeManualResult("wrong-page", { tab: null, pageState: "unsupported" }, false, 0);
      }
      if (
        !isSafeReportCenterTab(currentTab) ||
        currentTab.windowId !== context.tab.windowId ||
        currentTab.url !== context.tab.url ||
        !await isLastFocusedNormalWindow(currentTab.windowId)
      ) {
        const state = await readStateAfterPendingWrites();
        return makeManualResult("page-not-ready", { tab: currentTab, pageState: "loading" }, false, state.workflows.length);
      }

      const allowance = await assessActiveAllowanceForTab(currentTab);
      if (!allowance.available) {
        const state = await readStateAfterPendingWrites();
        return makeManualResult("check-unavailable", context, false, state.workflows.length);
      }

      const claimed = await mutateState((state) => {
        if (state.workflows.some((workflow) => workflow.sourceTabId === currentTab.id)) {
          return { code: "fix-in-progress", activeCount: state.workflows.length };
        }
        if (state.activationAttempts.some(
          (attempt) =>
            attempt.tabId === currentTab.id &&
            ["reload-scheduled", "reload-pending"].includes(attempt.phase)
        )) {
          return { code: "fix-in-progress", activeCount: state.workflows.length };
        }
        if (
          allowance.active ||
          state.recent.some(
            (entry) => entry.sourceTabId === currentTab.id && entry.outcome === "replay-scheduled"
          )
        ) {
          return { code: "fix-already-applied", activeCount: state.workflows.length };
        }

        const latestActivityAt = Math.max(
          0,
          ...state.recent
            .filter((entry) => entry.sourceTabId === currentTab.id)
            .map((entry) => entry.at),
          ...state.activationAttempts
            .filter((attempt) => attempt.tabId === currentTab.id)
            .map((attempt) => attempt.at)
        );
        if (latestActivityAt && Date.now() - latestActivityAt < MANUAL_FIX_COOLDOWN_MS) {
          return { code: "manual-fix-cooldown", activeCount: state.workflows.length };
        }

        // Only terminal records for this tab are cleared. Active workflows and
        // uncertain pending reloads are never discarded by the manual action.
        const remainingAttempts = state.activationAttempts.filter(
          (attempt) => attempt.tabId !== currentTab.id
        );
        if (remainingAttempts.length >= MAX_ACTIVATION_RECOVERY_ATTEMPTS) {
          return { code: "manual-fix-failed", activeCount: state.workflows.length };
        }
        const attempt = makeActivationRecoveryAttempt(
          currentTab.id,
          SF_ACTIVATION_BUILD,
          Date.now(),
          "reload-scheduled"
        );
        if (!attempt) return { code: "manual-fix-failed", activeCount: state.workflows.length };
        state.recent = state.recent.filter((entry) => entry.sourceTabId !== currentTab.id);
        state.activationAttempts = [...remainingAttempts, attempt];
        state.lastStatus = makeLastStatus("page-refreshing");
        return { code: "manual-refresh-started", activeCount: state.workflows.length };
      });

      if (claimed.code !== "manual-refresh-started") {
        return makeManualResult(claimed.code, context, false, claimed.activeCount);
      }

      // Revalidate after the durable write-ahead claim. If focus or navigation
      // changed, remove the new claim and do not touch the page now in the tab.
      let finalTab;
      try {
        finalTab = await chrome.tabs.get(currentTab.id);
      } catch {
        await removeActivationAttempt(currentTab.id, SF_ACTIVATION_BUILD);
        return makeManualResult("manual-fix-failed", context, false, claimed.activeCount);
      }
      if (
        !isSafeReportCenterTab(finalTab) ||
        finalTab.windowId !== currentTab.windowId ||
        finalTab.url !== currentTab.url ||
        !await isLastFocusedNormalWindow(finalTab.windowId)
      ) {
        await removeActivationAttempt(currentTab.id, SF_ACTIVATION_BUILD);
        const nextState = isSupportedReportCenterUrl(finalTab.url) ? "loading" : "unsupported";
        const code = nextState === "unsupported" ? "wrong-page" : "page-not-ready";
        return makeManualResult(code, { tab: finalTab, pageState: nextState }, false, claimed.activeCount);
      }

      // Give the popup time to render the accepted result before the underlying
      // page reload can close it. The delayed side effect revalidates again and
      // remains covered by the already-durable one-shot claim.
      scheduleClaimedReportCenterReload(currentTab.id, currentTab.windowId, currentTab.url);
      return makeManualResult(
        "manual-refresh-started",
        {
          tab: finalTab,
          pageState: finalTab.status === "complete" ? "ready" : "loading"
        },
        false,
        claimed.activeCount
      );
    });
  } catch {
    const state = await readStateAfterPendingWrites().catch(() => null);
    return makeManualResult(
      "manual-fix-failed",
      context || { tab: null, pageState: "unsupported" },
      false,
      state?.workflows?.length || 0
    );
  }
}

function scheduleClaimedReportCenterReload(tabId, windowId, expectedUrl) {
  setTimeout(() => {
    void performClaimedReportCenterReload(tabId, windowId, expectedUrl).catch(() => undefined);
  }, MANUAL_RELOAD_DELAY_MS);
}

async function performClaimedReportCenterReload(tabId, windowId, expectedUrl) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    await removeActivationAttempt(tabId, SF_ACTIVATION_BUILD);
    return;
  }
  const state = await readStateAfterPendingWrites();
  const scheduled = state.activationAttempts.some(
    (attempt) =>
      attempt.tabId === tabId &&
      attempt.version === SF_ACTIVATION_BUILD &&
      attempt.phase === "reload-scheduled"
  );
  if (
    !scheduled ||
    tab.windowId !== windowId ||
    tab.url !== expectedUrl ||
    !isSafeReportCenterTab(tab) ||
    !await isLastFocusedNormalWindow(tab.windowId)
  ) {
    if (scheduled) await removeActivationAttempt(tabId, SF_ACTIVATION_BUILD);
    return;
  }

  const claimed = await mutateState((current) => {
    const attempt = current.activationAttempts.find(
      (entry) =>
        entry.tabId === tabId &&
        entry.version === SF_ACTIVATION_BUILD &&
        entry.phase === "reload-scheduled"
    );
    if (!attempt) return false;
    attempt.phase = "reload-pending";
    return true;
  });
  if (!claimed) return;

  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    await removeActivationAttempt(tabId, SF_ACTIVATION_BUILD);
    return;
  }
  if (
    tab.windowId !== windowId ||
    tab.url !== expectedUrl ||
    !isSafeReportCenterTab(tab) ||
    !await isLastFocusedNormalWindow(tab.windowId)
  ) {
    await removeActivationAttempt(tabId, SF_ACTIVATION_BUILD);
    return;
  }
  try {
    await chrome.tabs.reload(tabId, { bypassCache: false });
  } catch {
    // The write-ahead claim remains authoritative after an ambiguous reload.
  }
}

async function getActiveReportCenterContext() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    });
  } catch {
    return { tab: null, pageState: "unavailable" };
  }
  const tab = Array.isArray(tabs)
    ? tabs.find((candidate) => isSupportedReportCenterUrl(candidate?.url))
    : null;
  if (!tab) return { tab: null, pageState: "unsupported" };
  if (!isSafeReportCenterTab(tab)) return { tab, pageState: "loading" };
  // A toolbar action popup can temporarily own native focus on Windows. The
  // underlying Edge window is still the user's last-focused normal window,
  // which is the browser-defined context for an action-popup request.
  if (!await isLastFocusedNormalWindow(tab.windowId)) {
    return { tab: null, pageState: "unsupported" };
  }
  return { tab, pageState: tab.status === "complete" ? "ready" : "loading" };
}

function contextualStatusCode(state, context, allowance) {
  if (context.pageState === "unavailable") return "check-unavailable";
  if (!context.tab) return "unsupported-page";
  const tabId = context.tab.id;
  if (state.workflows.some((workflow) => workflow.sourceTabId === tabId)) {
    return "continuation-in-progress";
  }
  const pending = state.activationAttempts.find(
    (attempt) =>
      attempt.tabId === tabId &&
      ["reload-scheduled", "reload-pending"].includes(attempt.phase)
  );
  if (pending) return "page-refreshing";

  const recent = [...state.recent].reverse().find((entry) => entry.sourceTabId === tabId);
  if (recent?.outcome === "replay-scheduled") return "replay-scheduled";
  if (allowance.active) return "replay-scheduled";
  if (!allowance.available) return "check-unavailable";
  if (recent) return recent.outcome;

  const prepared = state.activationAttempts.find(
    (attempt) => attempt.tabId === tabId && attempt.phase === "reload-attempted"
  );
  if (prepared) return "page-prepared";
  return context.pageState === "loading" ? "page-not-ready" : "idle";
}

function hasImmediateStatusEvidence(state, tabId) {
  return Boolean(
    state.workflows.some((workflow) => workflow.sourceTabId === tabId) ||
    state.activationAttempts.some(
      (attempt) =>
        attempt.tabId === tabId &&
        ["reload-scheduled", "reload-pending"].includes(attempt.phase)
    ) ||
    state.recent.some(
      (entry) => entry.sourceTabId === tabId && entry.outcome === "replay-scheduled"
    )
  );
}

function canForceFixCurrentPage(state, context, allowance, now = Date.now()) {
  if (!context.tab || !["loading", "ready"].includes(context.pageState)) return false;
  const tabId = context.tab.id;
  if (state.workflows.some((workflow) => workflow.sourceTabId === tabId)) return false;
  if (state.activationAttempts.some(
    (attempt) =>
      attempt.tabId === tabId &&
      ["reload-scheduled", "reload-pending"].includes(attempt.phase)
  )) return false;
  if (
    allowance.active ||
    !allowance.available ||
    state.recent.some(
      (entry) => entry.sourceTabId === tabId && entry.outcome === "replay-scheduled"
    )
  ) return false;
  const latestActivityAt = Math.max(
    0,
    ...state.recent.filter((entry) => entry.sourceTabId === tabId).map((entry) => entry.at),
    ...state.activationAttempts.filter((attempt) => attempt.tabId === tabId).map((attempt) => attempt.at)
  );
  return !latestActivityAt || now - latestActivityAt >= MANUAL_FIX_COOLDOWN_MS;
}

async function assessActiveAllowanceForTab(tab) {
  if (!await localLedgerAccessPromise) return { active: false, available: false };
  let sourceOrigin;
  try {
    sourceOrigin = parseSuccessFactorsOrigin(new URL(tab.url).origin);
  } catch {
    return { active: false, available: false };
  }
  if (!sourceOrigin) return { active: false, available: false };
  let ledger;
  try {
    ledger = await readReliableLedger();
  } catch {
    return { active: false, available: false };
  }
  const entries = ledger.entries.filter((entry) => entry.sourceOrigin === sourceOrigin);
  if (!entries.length) return { active: false, available: true };

  // A profile may have several exact IAS tenants for the same SuccessFactors
  // origin. Read them concurrently so a bounded popup status never scales
  // linearly with the ledger size. This remains read-only and capped at 20.
  const results = await Promise.all(entries.map(async (entry) => {
    try {
      const pair = makeCookieExceptionPair(entry.iasOrigin, entry.sourceOrigin);
      const effective = await getEffectiveCookieSetting(pair);
      return effective?.setting === "allow" ? "allow" : "not-allow";
    } catch {
      return "failed";
    }
  }));
  if (results.includes("allow")) return { active: true, available: true };
  return results.includes("failed")
    ? { active: false, available: false }
    : { active: false, available: true };
}

function makeManualResult(code, context, canFixCurrentPage, activeCount) {
  return {
    code,
    activeCount,
    version: chrome.runtime.getManifest().version,
    canFixCurrentPage,
    currentPageState: context.pageState
  };
}

async function readState() {
  const stored = await chrome.storage.session.get(STATE_KEY);
  return pruneSessionState(stored[STATE_KEY]);
}

async function readStateAfterPendingWrites() {
  const pending = stateQueue;
  await pending.catch(() => undefined);
  return readState();
}

function mutateState(mutator) {
  const task = stateQueue.then(async () => {
    const stored = await chrome.storage.session.get(STATE_KEY);
    const state = pruneSessionState(stored[STATE_KEY]);
    const result = await mutator(state);
    await chrome.storage.session.set({ [STATE_KEY]: state });
    return result;
  });
  stateQueue = task.catch(() => undefined);
  return task;
}

async function refreshBadge() {
  const state = await readStateAfterPendingWrites();
  const count = state.workflows.length;
  await chrome.action.setBadgeBackgroundColor({ color: "#0a6ed1" });
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
}

async function focusWindow(windowId) {
  if (!Number.isInteger(windowId)) return;
  try {
    await chrome.windows.update(windowId, { focused: true });
  } catch {
    // Tab activation remains useful even when window focus is denied.
  }
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort();
  return actual.length === expectedKeys.length && actual.every((key, index) => key === expectedKeys[index]);
}

function isSafeSourceDocumentId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
