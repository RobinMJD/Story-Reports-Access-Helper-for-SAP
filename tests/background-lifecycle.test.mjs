import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ACTIVATION_RECOVERY_ATTEMPTS,
  MAX_RELIABLE_PAIRS,
  RELIABLE_ALARM_NAME,
  RELIABLE_LEDGER_KEY,
  RELIABLE_RULE_TTL_MS,
  STATE_KEY,
  STORY_REPORT_HASH,
  STORY_REPORT_PATH,
  createEmptyState,
  isSupportedReportCenterUrl,
  isSafeResumeAttemptId,
  makeActivationRecoveryAttempt,
  makeReliableLedgerEntry
} from "../src/core.js";

const IAS_ORIGIN = "https://tenant.accounts.ondemand.com";
const IAS_FRAME_URL = `${IAS_ORIGIN}/saml2/idp/sso/tenant`;
const SF_ORIGIN = "https://sampletenant.successfactors.eu";
const STORY_URL = `${SF_ORIGIN}${STORY_REPORT_PATH}${STORY_REPORT_HASH}`;
const STORY_QUERY_PATTERNS = [
  "https://*.successfactors.com/xi/ui/reportcenter/pages/reportCenter.xhtml*",
  "https://*.successfactors.eu/xi/ui/reportcenter/pages/reportCenter.xhtml*",
  "https://*.successfactors.cn/xi/ui/reportcenter/pages/reportCenter.xhtml*",
  "https://*.sapsf.com/xi/ui/reportcenter/pages/reportCenter.xhtml*",
  "https://*.sapsf.eu/xi/ui/reportcenter/pages/reportCenter.xhtml*",
  "https://*.sapsf.cn/xi/ui/reportcenter/pages/reportCenter.xhtml*",
  "https://*.hr.cloud.sap/xi/ui/reportcenter/pages/reportCenter.xhtml*",
  "https://*.sapcloud.cn/xi/ui/reportcenter/pages/reportCenter.xhtml*"
];
const LEGACY_RELIABLE_CONTROL_KEY = "sapIasReliableModeControl.v1";
const SF_ACTIVATION_BUILD_KEY = "sapStoryAccessActivationBuild.v1";
const ATTEMPT_ID = "123e4567-e89b-42d3-a456-426614174000";

test("cold-worker messages wait for startup reconciliation before any workflow claim", async () => {
  const harness = await createHarness({ holdInitialReconcile: true, coldDetection: true });
  assert.equal(harness.coldEvents.includes("direct-claimed"), false, harness.coldEvents.join(", "));
  assert.equal(harness.coldResult.code, "replay-scheduled");
  assert.equal(harness.resumes.length, 1);
  assert.equal(harness.state().recent[0].outcome, "replay-scheduled");
});

test("automatic mode writes, verifies, commits, and resumes one exact document in order", async () => {
  const harness = await createHarness();
  assert.ok(
    harness.startupEvents.indexOf("local-access-protected") < harness.startupEvents.indexOf("local-read"),
    harness.startupEvents.join(", ")
  );
  harness.resetTrace();

  const result = await harness.detect();
  assert.equal(result.code, "replay-scheduled");
  assert.equal(harness.resumes.length, 1);
  assert.deepEqual(harness.resumes[0].options, { documentId: "source-doc-1" });
  assert.equal(harness.resumes[0].message.type, "resume-with-cookie-exception");
  assert.equal(isSafeResumeAttemptId(harness.resumes[0].message.resumeAttemptId), true);
  assert.deepEqual(harness.cookieClears, [{ scope: "regular" }]);
  assert.deepEqual(harness.cookieSets, [{
    primaryPattern: "https://tenant.accounts.ondemand.com:443/*",
    secondaryPattern: "https://sampletenant.successfactors.eu:443/*",
    setting: "allow",
    scope: "regular"
  }]);
  assert.deepEqual(harness.cookieGets, [{
    primaryUrl: `${IAS_ORIGIN}/`,
    secondaryUrl: `${SF_ORIGIN}/`,
    incognito: false
  }]);

  const ordered = [
    "direct-claimed",
    "ledger-written",
    "cookies-cleared",
    "cookie-set",
    "cookie-get",
    "resume-claimed",
    "source-resume-requested",
    "replay-commit-stored",
    "replay-commit-acknowledged"
  ].map((name) => harness.events.indexOf(name));
  assert.ok(ordered.every((index) => index >= 0), harness.events.join(", "));
  assert.deepEqual([...ordered].sort((left, right) => left - right), ordered);

  const ledger = harness.local[RELIABLE_LEDGER_KEY];
  assert.equal(ledger.entries.length, 1);
  assert.equal(harness.alarmCreates.at(-1).details.when, ledger.entries[0].expiresAt);
  assert.equal(harness.state().workflows.length, 0);
  assert.equal(harness.state().recent.length, 1);
  assert.equal(harness.state().recent[0].outcome, "replay-scheduled");
  assert.equal(harness.replayCommitAcks, 1);
  assert.equal(Object.hasOwn(harness.chrome.tabs, "create"), false);
  assert.equal(Object.hasOwn(harness.chrome.tabs, "remove"), false);
  assert.equal(harness.tabReloads.length, 0);
});

test("reusing an exact pair preserves its original hard expiry", async () => {
  const harness = await createHarness();
  const original = makeReliableLedgerEntry(IAS_ORIGIN, SF_ORIGIN, Date.now() - 10 * 60 * 1000);
  harness.local[RELIABLE_LEDGER_KEY] = { version: 1, entries: [clone(original)] };
  harness.resetTrace();

  assert.equal((await harness.detect()).code, "replay-scheduled");
  assert.deepEqual(harness.local[RELIABLE_LEDGER_KEY].entries, [original]);
  assert.equal(harness.alarmCreates.at(-1).details.when, original.expiresAt);
});

test("the twenty-pair cap blocks a new pair without eviction or continuation", async () => {
  const harness = await createHarness();
  const createdAt = Date.now() - 1_000;
  harness.local[RELIABLE_LEDGER_KEY] = {
    version: 1,
    entries: Array.from({ length: MAX_RELIABLE_PAIRS }, (_, index) =>
      makeReliableLedgerEntry(
        `https://tenant${index}.accounts.ondemand.com`,
        `https://customer${index}.sapsf.eu`,
        createdAt
      )
    )
  };
  harness.resetTrace();

  assert.equal((await harness.detect()).code, "automatic-fix-blocked");
  assert.equal(harness.local[RELIABLE_LEDGER_KEY].entries.length, MAX_RELIABLE_PAIRS);
  assert.equal(harness.resumes.length, 0);
  assert.equal(harness.state().recent.at(-1).outcome, "automatic-fix-blocked");
});

test("detections require a bounded control-free browser document identity", async () => {
  const harness = await createHarness();
  harness.resetTrace();
  for (const documentId of ["", "x".repeat(129), "source-doc\n2"]) {
    assert.equal((await harness.detect({ documentId })).code, "ignored", JSON.stringify(documentId));
  }
  assert.equal(harness.state().workflows.length, 0);
  assert.equal(harness.resumes.length, 0);
});

test("permission, storage, alarm, rule, and policy failures are terminal with no continuation", async (t) => {
  const scenarios = [
    ["permission missing", { permissionGranted: false }],
    ["protected local unavailable", { localAccessFails: true }],
    ["ledger write fails", { ledgerWriteFails: true }],
    ["retry alarm fails", { alarmCreateFails: true }],
    ["rule clear fails", { cookieClearFails: true }],
    ["rule set fails", { cookieSetFails: true }],
    ["policy read fails", { cookieGetFails: true }],
    ["policy overrides allow", { effectiveCookieSetting: "block" }]
  ];
  for (const [name, options] of scenarios) {
    await t.test(name, async () => {
      const harness = await createHarness(options);
      harness.resetTrace();
      const result = await harness.detect();
      assert.equal(result.code, "automatic-fix-blocked");
      assert.equal(harness.resumes.length, 0);
      assert.equal(harness.replayCommitAcks, 0);
      assert.equal(harness.state().workflows.length, 0);
      assert.equal(harness.state().recent.at(-1).outcome, "automatic-fix-blocked");

      const repeated = await harness.detect({ documentId: "source-doc-2", frameId: 8 });
      assert.equal(repeated.code, "automatic-fix-blocked");
      assert.equal(harness.resumes.length, 0);
    });
  }
});

test("an ineffective allowance reported by the exact document is terminal", async () => {
  const harness = await createHarness();
  harness.setResumeResponse({
    ready: true,
    replaySubmitted: false,
    code: "cookie-exception-not-active",
    iasOrigin: IAS_ORIGIN,
    sourceOrigin: SF_ORIGIN
  });
  harness.resetTrace();

  assert.equal((await harness.detect()).code, "automatic-fix-blocked");
  assert.equal(harness.resumes.length, 1);
  assert.equal(harness.replayCommitAcks, 0);
  assert.equal(harness.state().recent[0].outcome, "automatic-fix-blocked");
  assert.equal((await harness.detect({ documentId: "source-doc-2", frameId: 8 })).code,
    "automatic-fix-blocked");
  assert.equal(harness.resumes.length, 1);
});

test("document replacement during a claim cannot create a second continuation", async () => {
  const harness = await createHarness();
  let raced;
  harness.setResumeHook(async () => {
    raced = await harness.detect({ documentId: "source-doc-2", frameId: 8 });
  });
  harness.resetTrace();

  assert.equal((await harness.detect()).code, "replay-scheduled");
  assert.equal(raced.code, "continuation-in-progress");
  assert.equal(harness.resumes.length, 1);
  assert.equal((await harness.detect({ documentId: "source-doc-3", frameId: 9 })).code,
    "replay-scheduled");
  assert.equal(harness.resumes.length, 1);
});

test("an ambiguous exact-document transport is tombstoned and never retried", async () => {
  const harness = await createHarness();
  harness.setResumeHook(async () => { throw new Error("document-replaced"); });
  harness.resetTrace();

  assert.equal((await harness.detect()).code, "resume-interrupted");
  assert.equal(harness.resumes.length, 1);
  assert.equal(harness.state().recent.at(-1).outcome, "resume-interrupted");
  assert.equal((await harness.detect({ documentId: "source-doc-2", frameId: 8 })).code,
    "resume-interrupted");
  assert.equal(harness.resumes.length, 1);
});

test("a durable commit survives outer-channel loss and duplicate commit delivery", async () => {
  const harness = await createHarness();
  harness.setOuterResponseFailsAfterCommit(true);
  harness.resetTrace();

  assert.equal((await harness.detect()).code, "replay-scheduled");
  const recent = harness.state().recent[0];
  assert.equal(recent.outcome, "replay-scheduled");
  assert.equal(harness.replayCommitAcks, 1);
  assert.ok(harness.events.indexOf("replay-commit-stored") < harness.events.indexOf("replay-commit-acknowledged"));

  const duplicate = await harness.commit(recent.resumeAttemptId);
  assert.deepEqual(duplicate, {
    ok: true,
    code: "replay-schedule-committed",
    resumeAttemptId: recent.resumeAttemptId
  });
  assert.equal(harness.state().recent.length, 1);
});

test("startup safely retries only preparing work and tombstones a claimed continuation", async (t) => {
  await t.test("preparing", async () => {
    const harness = await createHarness();
    const state = createEmptyState();
    state.workflows.push(makeDirectWorkflow());
    harness.setState(state);
    harness.resetTrace();
    await harness.restart();
    await harness.until(() => harness.state().recent.length === 1);
    assert.equal(harness.state().recent[0].outcome, "replay-scheduled");
    assert.equal(harness.resumes.length, 1);
  });

  await t.test("already claimed", async () => {
    const harness = await createHarness();
    const state = createEmptyState();
    const createdAt = Date.now() - 1_000;
    state.workflows.push(makeDirectWorkflow({
      createdAt,
      status: "direct-resuming",
      resumeRequestedAt: createdAt + 500,
      resumeAttemptId: ATTEMPT_ID
    }));
    harness.setState(state);
    harness.resetTrace();
    await harness.restart();
    await harness.until(() => harness.state().recent.length === 1);
    assert.equal(harness.state().recent[0].outcome, "resume-interrupted");
    assert.equal(harness.resumes.length, 0);
  });
});

test("expiry reconciliation prunes expired entries and reapplies only canonical active pairs", async () => {
  const harness = await createHarness();
  const now = Date.now();
  const active = makeReliableLedgerEntry(IAS_ORIGIN, SF_ORIGIN, now - 1_000);
  const expired = makeReliableLedgerEntry(
    "https://old.accounts.ondemand.com",
    "https://old.sapsf.eu",
    now - RELIABLE_RULE_TTL_MS - 1
  );
  harness.local[RELIABLE_LEDGER_KEY] = { version: 1, entries: [expired, active] };
  harness.resetTrace();

  harness.fireAlarm();
  await harness.until(() => harness.cookieSets.length === 1 && harness.alarmCreates.length >= 2);
  assert.deepEqual(harness.local[RELIABLE_LEDGER_KEY].entries, [active]);
  assert.deepEqual(harness.cookieClears, [{ scope: "regular" }]);
  assert.equal(harness.cookieSets[0].primaryPattern, "https://tenant.accounts.ondemand.com:443/*");
  assert.equal(harness.alarmCreates.at(-1).details.when, active.expiresAt);
});

test("v1 removes every legacy pause marker and restores automatic fixing on startup", async () => {
  const harness = await createHarness();
  const active = makeReliableLedgerEntry(IAS_ORIGIN, SF_ORIGIN, Date.now() - 1_000);
  harness.local[LEGACY_RELIABLE_CONTROL_KEY] = {
    version: 2,
    status: "paused",
    updatedAt: Date.now() - 500
  };
  harness.local[RELIABLE_LEDGER_KEY] = { version: 1, entries: [active] };
  harness.resetTrace();

  await harness.restart();
  await harness.until(() => harness.events.includes("legacy-control-removed"));
  assert.equal(harness.local[LEGACY_RELIABLE_CONTROL_KEY], undefined);
  assert.deepEqual(harness.local[RELIABLE_LEDGER_KEY].entries, [active]);
  assert.equal(harness.cookieSets.length, 1);

  harness.resetTrace();
  assert.equal((await harness.detect({ documentId: "source-doc-2", frameId: 8 })).code,
    "replay-scheduled");
  assert.equal(harness.resumes.length, 1);
});

test("only status is accepted from the exact popup sender and it exposes no sites", async () => {
  const harness = await createHarness();
  await harness.detect();
  harness.resetTrace();

  assert.equal((await harness.contentMessage({ type: "get-status" })).code, "ignored");
  assert.equal((await harness.popupTab({ type: "get-status" }, { frameId: 1 })).code, "ignored");
  assert.equal((await harness.popupTab({ type: "get-status" }, { incognito: true })).code, "ignored");
  assert.equal((await harness.popupTab({ type: "get-status" }, { tabUrl: IAS_FRAME_URL })).code, "ignored");
  assert.equal((await harness.popupMessage({ type: "get-status", extra: true })).code, "ignored");
  assert.equal((await harness.popup("pause-automatic-fixing")).code, "ignored");
  assert.equal((await harness.popup("resume-automatic-fixing")).code, "ignored");
  assert.equal(harness.cookieClears.length, 0);

  const status = await harness.popup("get-status");
  assert.equal(status.version, "1.1.0");
  assert.deepEqual(Object.keys(status).sort(), [
    "activeCount",
    "canFixCurrentPage",
    "code",
    "currentPageState",
    "ok",
    "version"
  ]);
  assert.equal(status.code, "unsupported-page");
  assert.equal(status.canFixCurrentPage, false);
  assert.equal(status.currentPageState, "unsupported");
  const serialized = JSON.stringify(status);
  assert.equal(serialized.includes(IAS_ORIGIN), false);
  assert.equal(serialized.includes(SF_ORIGIN), false);
  assert.equal(serialized.includes("https://"), false);
});

test("fresh install skips the generic startup scan and probes its active Report Center tab", async () => {
  const harness = await createHarness({ activationBuildMarker: null });
  assert.equal(harness.startupEvents.includes("tabs-queried"), false);
  assert.equal(harness.activationProbes.length, 0);
  harness.setTab(makeStoryTab());
  harness.resetTrace();

  harness.fireInstalled("install");
  await harness.until(() => harness.activationProbes.length === 1);
  await settle();
  assert.deepEqual(harness.tabQueries, [{
    active: true,
    lastFocusedWindow: true,
    url: STORY_QUERY_PATTERNS
  }]);
  assert.deepEqual(harness.activationProbes[0], {
    tabId: 20,
    message: { type: "sf-activation-probe", build: "1.1.0", protocol: 1 },
    options: { frameId: 0 }
  });
  assert.equal(harness.tabGets.length, 0);
  assert.equal(harness.tabReloads.length, 0);
  assert.deepEqual(harness.state().activationAttempts, []);
});

test("same-build worker startup scans an existing Report Center page without reloading a current sentinel", async () => {
  const harness = await createHarness({
    initialTab: makeStoryTab({ url: `${SF_ORIGIN}${STORY_REPORT_PATH}#/home` })
  });
  await harness.until(() => harness.activationProbes.length === 1);
  await settle();
  assert.deepEqual(harness.tabQueries, [{
    active: true,
    lastFocusedWindow: true,
    url: STORY_QUERY_PATTERNS
  }]);
  assert.equal(harness.tabReloads.length, 0);
  assert.deepEqual(harness.state().activationAttempts, []);
});

test("a version transition records the new build and skips an immediate active-tab scan", async () => {
  const harness = await createHarness({
    activationBuildMarker: "1.0.0",
    initialTab: makeStoryTab({ url: `${SF_ORIGIN}${STORY_REPORT_PATH}#/home` })
  });
  await settle();
  assert.equal(harness.local[SF_ACTIVATION_BUILD_KEY], "1.1.0");
  assert.equal(harness.tabQueries.length, 0);
  assert.equal(harness.activationProbes.length, 0);
  assert.equal(harness.tabReloads.length, 0);
});

test("same-build restart recovers a Report Center page that predates the restarted worker", async () => {
  const harness = await createHarness();
  harness.setTab(makeStoryTab({ url: `${SF_ORIGIN}${STORY_REPORT_PATH}#/home` }));
  harness.setActivationProbeFails(true);
  harness.resetTrace();
  await harness.restart();
  await harness.until(() => harness.tabReloads.length === 1);
  assert.equal(harness.activationProbes.length, 1);
  assert.equal(harness.state().activationAttempts[0].phase, "reload-pending");
});

test("an absent install sentinel on Report Center home is tombstoned and reloaded exactly once", async () => {
  const harness = await createHarness({ activationBuildMarker: null });
  harness.setTab(makeStoryTab({ url: `${SF_ORIGIN}${STORY_REPORT_PATH}#/home` }));
  harness.setActivationProbeFails(true);
  harness.resetTrace();

  harness.fireInstalled("install");
  await harness.until(() => harness.tabReloads.length === 1);
  assert.deepEqual(harness.tabReloads, [{ tabId: 20, details: { bypassCache: false } }]);
  assert.deepEqual(harness.tabGets, [20, 20]);
  const attempt = harness.state().activationAttempts[0];
  assert.deepEqual(Object.keys(attempt).sort(), ["at", "phase", "tabId", "version"]);
  assert.equal(attempt.tabId, 20);
  assert.equal(attempt.version, "1.1.0");
  assert.equal(attempt.phase, "reload-pending");
  assert.equal(JSON.stringify(attempt).includes("http"), false);
  assert.ok(
    harness.events.indexOf("activation-attempt-write") < harness.events.indexOf("tab-reload:20"),
    harness.events.join(", ")
  );

  harness.fireInstalled("install");
  await harness.until(() => harness.tabQueries.length === 2);
  await settle();
  assert.equal(harness.activationProbes.length, 2);
  assert.equal(harness.tabReloads.length, 1);
  assert.equal(harness.state().activationAttempts.length, 1);
});

test("update-family install events are inert while a later activation can recover the tab", async () => {
  const harness = await createHarness();
  harness.setTab(makeStoryTab());
  harness.setActivationProbeFails(true);
  harness.resetTrace();

  for (const reason of ["update", "chrome_update", "shared_module_update"]) {
    harness.fireInstalled(reason);
  }
  await settle();
  assert.equal(harness.tabQueries.length, 0);
  assert.equal(harness.activationProbes.length, 0);
  assert.equal(harness.tabReloads.length, 0);

  harness.fireActivated(20);
  await harness.until(() => harness.tabReloads.length === 1);
  assert.deepEqual(harness.tabGets, [20, 20, 20]);
  assert.equal(harness.activationProbes.length, 1);
});

test("completed Report Center navigation is evaluated and recovered through tabs.onUpdated", async () => {
  const harness = await createHarness();
  const homeUrl = `${SF_ORIGIN}${STORY_REPORT_PATH}#/home`;
  harness.setTab(makeStoryTab({ url: homeUrl }));
  harness.setActivationProbeFails(true);
  harness.resetTrace();

  harness.fireUpdated(20, { status: "complete" });
  await harness.until(() => harness.tabReloads.length === 1);
  assert.equal(harness.activationProbes.length, 1);
  assert.equal(harness.state().activationAttempts[0].phase, "reload-pending");

  harness.fireUpdated(20, { audible: false });
  await settle();
  assert.equal(harness.tabReloads.length, 1);
});

test("the popup reports current-tab state and schedules one guarded manual refresh after responding", async () => {
  const harness = await createHarness();
  harness.setTab(makeStoryTab({ url: `${SF_ORIGIN}${STORY_REPORT_PATH}#/home` }));
  harness.resetTrace();

  assert.deepEqual(await harness.popup("get-status"), {
    ok: true,
    code: "idle",
    activeCount: 0,
    version: "1.1.0",
    canFixCurrentPage: true,
    currentPageState: "ready"
  });

  const acceptedAt = Date.now();
  const accepted = await harness.popup("force-fix-current-tab");
  assert.deepEqual(accepted, {
    ok: true,
    code: "manual-refresh-started",
    activeCount: 0,
    version: "1.1.0",
    canFixCurrentPage: false,
    currentPageState: "ready"
  });
  assert.equal(harness.tabReloads.length, 0, "popup response precedes the delayed reload");
  assert.equal(harness.state().activationAttempts[0].phase, "reload-scheduled");

  const duplicate = await harness.popup("force-fix-current-tab");
  assert.equal(duplicate.code, "fix-in-progress");
  assert.equal(duplicate.canFixCurrentPage, false);

  await harness.until(() => harness.tabReloads.length === 1, 2_000);
  assert.ok(Date.now() - acceptedAt >= 1_100);
  await settle(25);
  assert.equal(harness.tabReloads.length, 1);
  assert.equal(harness.state().activationAttempts[0].phase, "reload-pending");
  assert.ok(
    harness.events.indexOf("activation-attempt-write") < harness.events.indexOf("tab-reload:20"),
    harness.events.join(", ")
  );

  harness.setTab(makeStoryTab({
    status: "loading",
    url: `${SF_ORIGIN}${STORY_REPORT_PATH}#/home`
  }));
  assert.equal((await harness.activationReady()).code, "sf-activation-ready");
  harness.setTab(makeStoryTab({ url: `${SF_ORIGIN}${STORY_REPORT_PATH}#/home` }));
  const prepared = await harness.popup("get-status");
  assert.equal(prepared.code, "page-prepared");
  assert.equal(prepared.canFixCurrentPage, false);
});

test("manual refresh clears only stale terminal records for the active tab", async () => {
  const harness = await createHarness();
  harness.setTab(makeStoryTab({ url: `${SF_ORIGIN}${STORY_REPORT_PATH}#/home` }));
  const state = createEmptyState();
  const oldAt = Date.now() - 31_000;
  state.recent.push({
    sourceTabId: 20,
    sourceWindowId: 2,
    sourceFrameId: 7,
    sourceDocumentId: "old-target-document",
    iasOrigin: IAS_ORIGIN,
    sourceOrigin: SF_ORIGIN,
    outcome: "automatic-fix-blocked",
    at: oldAt
  }, {
    sourceTabId: 99,
    sourceWindowId: 2,
    sourceFrameId: 8,
    sourceDocumentId: "other-tab-document",
    iasOrigin: IAS_ORIGIN,
    sourceOrigin: SF_ORIGIN,
    outcome: "automatic-fix-blocked",
    at: oldAt
  });
  state.activationAttempts.push(
    makeActivationRecoveryAttempt(20, "1.1.0", oldAt, "reload-attempted"),
    makeActivationRecoveryAttempt(99, "1.1.0", oldAt, "reload-attempted")
  );
  harness.setState(state);
  harness.resetTrace();

  assert.equal((await harness.popup("force-fix-current-tab")).code, "manual-refresh-started");
  assert.equal(harness.state().recent.some((entry) => entry.sourceTabId === 20), false);
  assert.equal(harness.state().recent.some((entry) => entry.sourceTabId === 99), true);
  assert.equal(
    harness.state().activationAttempts.some(
      (attempt) => attempt.tabId === 20 && attempt.phase === "reload-attempted"
    ),
    false
  );
  assert.equal(
    harness.state().activationAttempts.some(
      (attempt) => attempt.tabId === 99 && attempt.phase === "reload-attempted"
    ),
    true
  );
  await harness.until(() => harness.tabReloads.length === 1, 2_000);
});

test("verified current-origin allowances are reported as applied and override old failures", async () => {
  const harness = await createHarness();
  harness.setTab(makeStoryTab({ url: `${SF_ORIGIN}${STORY_REPORT_PATH}#/home` }));
  harness.local[RELIABLE_LEDGER_KEY] = {
    version: 1,
    entries: [makeReliableLedgerEntry(IAS_ORIGIN, SF_ORIGIN, Date.now() - 1_000)]
  };
  const state = createEmptyState();
  state.recent.push({
    sourceTabId: 20,
    sourceWindowId: 2,
    sourceFrameId: 7,
    sourceDocumentId: "old-failed-document",
    iasOrigin: IAS_ORIGIN,
    sourceOrigin: SF_ORIGIN,
    outcome: "automatic-fix-blocked",
    at: Date.now() - 5_000
  });
  harness.setState(state);
  harness.resetTrace();

  const status = await harness.popup("get-status");
  assert.equal(status.code, "replay-scheduled");
  assert.equal(status.canFixCurrentPage, false);
  assert.equal(status.currentPageState, "ready");
  assert.equal(harness.cookieGets.length, 1);
  assert.equal((await harness.popup("force-fix-current-tab")).code, "fix-already-applied");
  assert.equal(harness.tabReloads.length, 0);
});

test("a stored allowance overridden by browser policy is not reported as applied", async () => {
  const harness = await createHarness();
  harness.setTab(makeStoryTab({ url: `${SF_ORIGIN}${STORY_REPORT_PATH}#/home` }));
  harness.local[RELIABLE_LEDGER_KEY] = {
    version: 1,
    entries: [makeReliableLedgerEntry(IAS_ORIGIN, SF_ORIGIN, Date.now() - 1_000)]
  };
  harness.setEffectiveCookieSetting("block");
  harness.resetTrace();

  const status = await harness.popup("get-status");
  assert.equal(status.code, "idle");
  assert.equal(status.canFixCurrentPage, true);
  assert.equal(harness.cookieGets.length, 1);
});

test("an unverifiable effective allowance reports check-unavailable and manual action fails closed", async () => {
  const harness = await createHarness();
  harness.setTab(makeStoryTab({ url: `${SF_ORIGIN}${STORY_REPORT_PATH}#/home` }));
  harness.local[RELIABLE_LEDGER_KEY] = {
    version: 1,
    entries: [makeReliableLedgerEntry(IAS_ORIGIN, SF_ORIGIN, Date.now() - 1_000)]
  };
  harness.setCookieGetFails(true);
  harness.resetTrace();

  const status = await harness.popup("get-status");
  assert.equal(status.code, "check-unavailable");
  assert.equal(status.canFixCurrentPage, false);
  assert.equal((await harness.popup("force-fix-current-tab")).code, "check-unavailable");
  assert.deepEqual(harness.state().activationAttempts, []);
  assert.equal(harness.tabReloads.length, 0);
});

test("activation recovery rejects every ineligible or unsupported tab before probing", async () => {
  const cases = [
    { active: false },
    { status: "loading" },
    { incognito: true },
    { discarded: true },
    { frozen: true },
    { pendingUrl: STORY_URL },
    { url: `${SF_ORIGIN}${STORY_REPORT_PATH}#home` },
    { url: `https://sampletenant.successfactors.eu.evil.example${STORY_REPORT_PATH}${STORY_REPORT_HASH}` },
    { url: `https://sampletenant.successfactors.eu:8443${STORY_REPORT_PATH}${STORY_REPORT_HASH}` }
  ];
  for (const overrides of cases) {
    const harness = await createHarness();
    harness.setTab(makeStoryTab(overrides));
    harness.resetTrace();
    harness.fireActivated(20);
    await harness.until(() => harness.tabGets.length === 1);
    await settle();
    assert.equal(harness.activationProbes.length, 0, JSON.stringify(overrides));
    assert.equal(harness.tabReloads.length, 0, JSON.stringify(overrides));
    assert.deepEqual(harness.state().activationAttempts, [], JSON.stringify(overrides));
  }
});

test("a stale sentinel triggers recovery but a changed final tab fails closed", async () => {
  const stale = await createHarness();
  stale.setTab(makeStoryTab());
  stale.setActivationProbeResponse({ type: "sf-activation-current", build: "0.3.0", protocol: 1 });
  stale.resetTrace();
  stale.fireActivated(20);
  await stale.until(() => stale.tabReloads.length === 1);
  assert.equal(stale.state().activationAttempts.length, 1);

  const changed = await createHarness();
  changed.setTab(makeStoryTab());
  changed.setActivationProbeFails(true);
  changed.setActivationRereadHook(({ call }) => {
    if (call === 2) changed.setTab(makeStoryTab({ url: `${SF_ORIGIN}${STORY_REPORT_PATH}/extra#/home` }));
  });
  changed.resetTrace();
  changed.fireActivated(20);
  await changed.until(() => changed.tabGets.length === 2);
  await settle();
  assert.equal(changed.tabReloads.length, 0);
  assert.deepEqual(changed.state().activationAttempts, []);
});

test("activation recovery never probes or reloads an active tab in an unfocused window", async () => {
  const harness = await createHarness();
  harness.setTab(makeStoryTab());
  harness.setWindow({ id: 2, focused: false, incognito: false, type: "normal" });
  harness.setActivationProbeFails(true);
  harness.resetTrace();

  harness.fireInstalled("install");
  await harness.until(() => harness.tabQueries.length === 1);
  await settle();
  assert.equal(harness.activationProbes.length, 0);
  assert.equal(harness.tabReloads.length, 0);

  harness.fireActivated(20, 2);
  await harness.until(() => harness.tabGets.length === 1);
  await settle();
  assert.equal(harness.activationProbes.length, 0);
  assert.equal(harness.tabReloads.length, 0);
  assert.deepEqual(harness.state().activationAttempts, []);
  assert.deepEqual(harness.windowUpdates, []);

  harness.setWindow({ id: 2, focused: true, incognito: false, type: "normal" });
  harness.fireActivated(20, 2);
  await harness.until(() => harness.tabReloads.length === 1);
  assert.equal(harness.activationProbes.length, 1);
  assert.deepEqual(harness.windowUpdates, []);
});

test("activation recovery is inert on browser lookup failures and non-normal windows", async (t) => {
  await t.test("install query failure", async () => {
    const harness = await createHarness();
    harness.setTab(makeStoryTab());
    harness.setTabQueryFails(true);
    harness.resetTrace();
    harness.fireInstalled("install");
    await harness.until(() => harness.tabQueries.length === 1);
    await settle();
    assert.equal(harness.activationProbes.length, 0);
    assert.equal(harness.tabReloads.length, 0);
  });

  await t.test("activation tab lookup failure", async () => {
    const harness = await createHarness();
    harness.setTab(makeStoryTab());
    harness.setTabGetFails(true);
    harness.resetTrace();
    harness.fireActivated(20, 2);
    await harness.until(() => harness.tabGets.length === 1);
    await settle();
    assert.equal(harness.activationProbes.length, 0);
    assert.equal(harness.tabReloads.length, 0);
  });

  for (const [name, browserWindow] of [
    ["window lookup failure", null],
    ["popup window", { id: 2, focused: true, incognito: false, type: "popup" }],
    ["incognito window", { id: 2, focused: true, incognito: true, type: "normal" }]
  ]) {
    await t.test(name, async () => {
      const harness = await createHarness();
      harness.setTab(makeStoryTab());
      if (browserWindow) harness.setWindow(browserWindow);
      else harness.setWindowGetFails(true);
      harness.resetTrace();
      harness.fireActivated(20, 2);
      await harness.until(() => harness.windowGets.length === 1);
      await settle();
      assert.equal(harness.activationProbes.length, 0);
      assert.equal(harness.tabReloads.length, 0);
      assert.deepEqual(harness.windowUpdates, []);
    });
  }
});

test("a malformed sentinel response is not mistaken for the exact current build", async () => {
  const harness = await createHarness();
  harness.setTab(makeStoryTab());
  harness.setActivationProbeResponse({
    type: "sf-activation-current",
    build: "1.1.0",
    protocol: 1,
    extra: true
  });
  harness.resetTrace();

  harness.fireActivated(20, 2);
  await harness.until(() => harness.tabReloads.length === 1);
  assert.equal(harness.activationProbes.length, 1);
  assert.equal(harness.state().activationAttempts.length, 1);
});

test("focus loss or navigation around the write-ahead claim prevents an unrelated reload", async () => {
  const afterProbe = await createHarness();
  afterProbe.setTab(makeStoryTab());
  afterProbe.setActivationProbeFails(true);
  afterProbe.setActivationProbeHook(() => {
    afterProbe.setWindow({ id: 2, focused: false, incognito: false, type: "normal" });
  });
  afterProbe.resetTrace();
  afterProbe.fireActivated(20, 2);
  await afterProbe.until(() => afterProbe.activationProbes.length === 1);
  await settle();
  assert.equal(afterProbe.tabReloads.length, 0);
  assert.deepEqual(afterProbe.state().activationAttempts, []);
  assert.deepEqual(afterProbe.windowUpdates, []);

  const afterClaim = await createHarness();
  afterClaim.setTab(makeStoryTab());
  afterClaim.setActivationProbeFails(true);
  afterClaim.setActivationAttemptWriteHook(() => {
    afterClaim.setWindow({ id: 2, focused: false, incognito: false, type: "normal" });
  });
  afterClaim.resetTrace();
  afterClaim.fireActivated(20, 2);
  await afterClaim.until(() => afterClaim.events.includes("activation-attempt-write"));
  await settle();
  assert.equal(afterClaim.tabReloads.length, 0);
  assert.deepEqual(afterClaim.state().activationAttempts, []);
  assert.deepEqual(afterClaim.windowUpdates, []);

  const navigated = await createHarness();
  navigated.setTab(makeStoryTab());
  navigated.setActivationProbeFails(true);
  navigated.setActivationAttemptWriteHook(() => {
    navigated.setTab(makeStoryTab({ url: `${SF_ORIGIN}${STORY_REPORT_PATH}/extra#/home` }));
  });
  navigated.resetTrace();
  navigated.fireActivated(20, 2);
  await navigated.until(() => navigated.events.includes("activation-attempt-write"));
  await settle();
  assert.deepEqual(navigated.tabGets, [20, 20, 20]);
  assert.equal(navigated.tabReloads.length, 0);
  assert.deepEqual(navigated.state().activationAttempts, []);
});

test("workflow history, an existing attempt, or the global cap blocks probe and reload", async (t) => {
  const blockers = [
    ["active workflow", (state) => state.workflows.push(makeDirectWorkflow({ sourceTabId: 20 }))],
    ["recent workflow", (state) => state.recent.push({
      sourceTabId: 20,
      sourceWindowId: 1,
      sourceFrameId: 7,
      sourceDocumentId: "source-doc-history",
      iasOrigin: IAS_ORIGIN,
      sourceOrigin: SF_ORIGIN,
      outcome: "automatic-fix-blocked",
      at: Date.now()
    })],
    ["existing terminal attempt", (state) => state.activationAttempts.push(
      makeActivationRecoveryAttempt(20, "1.1.0", Date.now(), "reload-attempted")
    )],
    ["global cap", (state) => {
      state.activationAttempts = Array.from({ length: MAX_ACTIVATION_RECOVERY_ATTEMPTS }, (_, index) =>
        makeActivationRecoveryAttempt(100 + index, "1.1.0", Date.now() - index)
      );
    }]
  ];
  for (const [name, seed] of blockers) {
    await t.test(name, async () => {
      const harness = await createHarness();
      harness.setTab(makeStoryTab());
      const state = createEmptyState();
      seed(state);
      harness.setState(state);
      harness.resetTrace();
      harness.fireActivated(20);
      await harness.until(() => harness.tabGets.length === 1);
      await settle();
      assert.equal(harness.activationProbes.length, 0);
      assert.equal(harness.tabReloads.length, 0);
    });
  }
});

test("concurrent activation events can produce only one attempt and one reload", async () => {
  const harness = await createHarness();
  harness.setTab(makeStoryTab());
  harness.setActivationProbeFails(true);
  let releaseProbes;
  const probeGate = new Promise((resolve) => { releaseProbes = resolve; });
  harness.setActivationProbeHook(() => probeGate);
  harness.resetTrace();

  harness.fireActivated(20);
  harness.fireActivated(20);
  await harness.until(() => harness.activationProbes.length === 2);
  releaseProbes();
  await harness.until(() => harness.tabReloads.length === 1);
  await settle();
  assert.equal(harness.tabReloads.length, 1);
  assert.equal(harness.state().activationAttempts.length, 1);
});

test("a stale IAS detection racing an activation tombstone cannot set rules or continue", async () => {
  const harness = await createHarness();
  harness.setTab(makeStoryTab());
  harness.setActivationProbeFails(true);
  let staleDetection;
  harness.setActivationAttemptWriteHook(() => {
    if (!staleDetection) {
      staleDetection = harness.detect({
        sourceTabId: 20,
        documentId: "stale-ias-document",
        frameId: 7
      });
    }
  });
  harness.resetTrace();

  harness.fireActivated(20);
  await harness.until(() => staleDetection !== undefined);
  assert.equal((await staleDetection).code, "continuation-in-progress");
  await harness.until(() => harness.tabReloads.length === 1);
  assert.equal(harness.cookieSets.length, 0);
  assert.equal(harness.cookieGets.length, 0);
  assert.equal(harness.resumes.length, 0);
  assert.equal(harness.state().workflows.length, 0);
  assert.equal(harness.state().activationAttempts.length, 1);
});

test("the reloaded top-page sentinel hands pending recovery to IAS without permitting another reload", async () => {
  const harness = await createHarness();
  harness.setTab(makeStoryTab());
  harness.setActivationProbeFails(true);
  harness.resetTrace();

  harness.fireActivated(20, 2);
  await harness.until(() => harness.tabReloads.length === 1);
  assert.equal(harness.state().activationAttempts[0].phase, "reload-pending");

  harness.setTab(makeStoryTab({ status: "loading" }));
  assert.deepEqual(await harness.activationReady(), {
    ok: true,
    code: "sf-activation-ready"
  });
  assert.deepEqual(harness.state().activationAttempts, [{
    tabId: 20,
    version: "1.1.0",
    at: harness.state().activationAttempts[0].at,
    phase: "reload-attempted"
  }]);

  const resumed = await harness.detect({
    sourceTabId: 20,
    windowId: 2,
    frameId: 7,
    documentId: "ias-after-activation-reload"
  });
  assert.equal(resumed.code, "replay-scheduled");
  assert.equal(harness.resumes.length, 1);
  assert.equal(harness.cookieSets.length, 1);
  assert.equal(harness.state().activationAttempts[0].phase, "reload-attempted");

  harness.setTab(makeStoryTab({ status: "complete" }));
  const readsBeforeReactivation = harness.tabGets.length;
  harness.fireActivated(20, 2);
  await harness.until(() => harness.tabGets.length > readsBeforeReactivation);
  await settle();
  assert.equal(harness.tabReloads.length, 1);
  assert.equal(harness.activationProbes.length, 1);
  assert.equal(harness.state().activationAttempts[0].phase, "reload-attempted");
});

test("a later exact activation probe recovers a lost page-start handoff without another reload", async () => {
  const harness = await createHarness();
  harness.setTab(makeStoryTab());
  harness.setActivationProbeFails(true);
  harness.resetTrace();

  harness.fireActivated(20, 2);
  await harness.until(() => harness.tabReloads.length === 1);
  assert.equal(harness.state().activationAttempts[0].phase, "reload-pending");

  harness.setActivationProbeFails(false);
  harness.resetTrace();
  harness.fireActivated(20, 2);
  await harness.until(() => harness.state().activationAttempts[0]?.phase === "reload-attempted");
  assert.equal(harness.activationProbes.length, 1);
  assert.equal(harness.tabReloads.length, 0);

  assert.equal((await harness.detect({
    sourceTabId: 20,
    windowId: 2,
    frameId: 7,
    documentId: "ias-after-lost-ready"
  })).code, "replay-scheduled");
  assert.equal(harness.resumes.length, 1);
  assert.equal(harness.state().activationAttempts[0].phase, "reload-attempted");
});

test("only a current supported top-page sentinel can cover a pending reload", async () => {
  const harness = await createHarness();
  const state = createEmptyState();
  state.activationAttempts.push(makeActivationRecoveryAttempt(20, "1.1.0", Date.now()));
  harness.setState(state);
  harness.setTab(makeStoryTab({ status: "loading" }));
  harness.resetTrace();

  const rejected = [
    { frameId: 1 },
    { documentId: "" },
    { url: `${SF_ORIGIN}${STORY_REPORT_PATH}#home` },
    { senderId: "different-extension" },
    {
      message: {
        type: "sf-activation-ready",
        build: "1.1.0",
        protocol: 1,
        extra: true
      }
    },
    {
      message: {
        type: "sf-activation-ready",
        build: "0.3.0",
        protocol: 1
      }
    }
  ];
  for (const overrides of rejected) {
    assert.equal((await harness.activationReady(overrides)).code, "ignored");
    assert.equal(harness.state().activationAttempts[0].phase, "reload-pending");
  }

  harness.setTab(makeStoryTab({ status: "loading", url: `${SF_ORIGIN}${STORY_REPORT_PATH}#/home` }));
  assert.equal((await harness.activationReady({ url: STORY_URL })).code, "sf-activation-ready");
  assert.equal(harness.state().activationAttempts[0].phase, "reload-attempted");
});

test("reload ambiguity remains tombstoned, storage failure cannot reload, and tab removal frees the record", async () => {
  const ambiguous = await createHarness();
  ambiguous.setTab(makeStoryTab());
  ambiguous.setActivationProbeFails(true);
  ambiguous.setTabReloadFails(true);
  ambiguous.resetTrace();
  ambiguous.fireActivated(20);
  await ambiguous.until(() => ambiguous.tabReloads.length === 1);
  assert.equal(ambiguous.state().activationAttempts.length, 1);
  const readsBeforeRetry = ambiguous.tabGets.length;
  ambiguous.fireActivated(20);
  await ambiguous.until(() => ambiguous.tabGets.length > readsBeforeRetry);
  await settle();
  assert.equal(ambiguous.tabReloads.length, 1);
  ambiguous.fireRemoved(20);
  await ambiguous.until(() => ambiguous.state().activationAttempts.length === 0);

  const failedWrite = await createHarness();
  failedWrite.setTab(makeStoryTab());
  failedWrite.setActivationProbeFails(true);
  failedWrite.setActivationAttemptStorageFails(true);
  failedWrite.resetTrace();
  failedWrite.fireActivated(20);
  await failedWrite.until(() => failedWrite.events.includes("activation-attempt-write"));
  await settle();
  assert.equal(failedWrite.tabReloads.length, 0);
  assert.deepEqual(failedWrite.state().activationAttempts, []);
});

test("an unresponsive probe is bounded and a build mismatch disables recovery", async () => {
  const timed = await createHarness();
  timed.setTab(makeStoryTab());
  timed.setActivationProbeNeverResolves(true);
  timed.resetTrace();
  const startedAt = Date.now();
  timed.fireActivated(20);
  await timed.until(() => timed.tabReloads.length === 1, 1_500);
  assert.ok(Date.now() - startedAt >= 700);
  assert.ok(Date.now() - startedAt < 1_500);

  const mismatched = await createHarness({ manifestVersion: "0.3.0" });
  mismatched.setTab(makeStoryTab());
  mismatched.setActivationProbeFails(true);
  mismatched.resetTrace();
  mismatched.fireInstalled("install");
  mismatched.fireActivated(20);
  await settle();
  assert.equal(mismatched.tabQueries.length, 0);
  assert.equal(mismatched.activationProbes.length, 0);
  assert.equal(mismatched.tabReloads.length, 0);
});

function makeDirectWorkflow(overrides = {}) {
  return {
    mode: "direct",
    sourceTabId: 10,
    sourceWindowId: 1,
    sourceFrameId: 7,
    sourceDocumentId: "source-doc-1",
    iasOrigin: IAS_ORIGIN,
    sourceOrigin: SF_ORIGIN,
    createdAt: Date.now(),
    status: "direct-preparing",
    ...overrides
  };
}

function makeStoryTab(overrides = {}) {
  return {
    id: 20,
    windowId: 2,
    active: true,
    status: "complete",
    incognito: false,
    discarded: false,
    frozen: false,
    url: STORY_URL,
    ...overrides
  };
}

async function createHarness(options = {}) {
  const listeners = {
    message: null,
    removed: null,
    activated: null,
    updated: null,
    alarm: null,
    startup: null,
    installed: null
  };
  const session = {};
  const local = options.activationBuildMarker === null
    ? {}
    : { [SF_ACTIVATION_BUILD_KEY]: options.activationBuildMarker || "1.1.0" };
  const alarms = new Map();
  const defaultTab = options.initialTab || {
      id: 10,
      windowId: 1,
      active: true,
      status: "complete",
      incognito: false,
      discarded: false,
      frozen: false,
      url: IAS_FRAME_URL
    };
  const tabs = new Map([[defaultTab.id, clone(defaultTab)]]);
  const windows = new Map([
    [1, { id: 1, focused: true, incognito: false, type: "normal" }],
    [2, { id: 2, focused: true, incognito: false, type: "normal" }]
  ]);
  const events = [];
  const resumes = [];
  const cookieClears = [];
  const cookieSets = [];
  const cookieGets = [];
  const alarmCreates = [];
  const commitResponses = [];
  const tabQueries = [];
  const tabGets = [];
  const tabReloads = [];
  const windowGets = [];
  const windowUpdates = [];
  const activationProbes = [];
  let replayCommitAcks = 0;
  let permissionGranted = options.permissionGranted !== false;
  let effectiveCookieSetting = options.effectiveCookieSetting || "allow";
  let localAccessFails = options.localAccessFails === true;
  let ledgerWriteFails = options.ledgerWriteFails === true;
  let alarmCreateFails = options.alarmCreateFails === true;
  let alarmClearFails = false;
  let cookieClearFails = options.cookieClearFails === true;
  let cookieSetFails = options.cookieSetFails === true;
  let cookieGetFails = options.cookieGetFails === true;
  let commitStorageFails = false;
  let outerResponseFailsAfterCommit = false;
  let resumeHook = null;
  let activationProbeResponse = {
    type: "sf-activation-current",
    build: "1.1.0",
    protocol: 1
  };
  let activationProbeFails = false;
  let activationProbeNeverResolves = false;
  let activationProbeHook = null;
  let activationRereadHook = null;
  let activationAttemptWriteHook = null;
  let activationAttemptStorageFails = false;
  let tabQueryFails = false;
  let tabGetFails = false;
  let tabReloadFails = false;
  let windowGetFails = false;
  let windowGetHook = null;
  let manifestVersion = options.manifestVersion || "1.1.0";
  let resumeResponse = {
    ready: true,
    replayScheduled: true,
    code: "replay-scheduled",
    iasOrigin: IAS_ORIGIN,
    sourceOrigin: SF_ORIGIN
  };
  let releaseInitialRead;
  let initialReadHeld = options.holdInitialReconcile === true;
  const initialReadGate = initialReadHeld
    ? new Promise((resolve) => { releaseInitialRead = resolve; })
    : Promise.resolve();

  const fakeChrome = {
    runtime: {
      id: "extension-id",
      lastError: undefined,
      getManifest: () => ({ version: manifestVersion }),
      getURL: (path) => `chrome-extension://extension-id/${path}`,
      onMessage: { addListener: (listener) => { listeners.message = listener; } },
      onStartup: { addListener: (listener) => { listeners.startup = listener; } },
      onInstalled: { addListener: (listener) => { listeners.installed = listener; } }
    },
    storage: {
      session: {
        async get(key) {
          return { [key]: clone(session[key]) };
        },
        async set(value) {
          const next = value[STATE_KEY];
          const previous = session[STATE_KEY];
          if (
            commitStorageFails &&
            next?.recent?.some((entry) => entry.outcome === "replay-scheduled") &&
            !previous?.recent?.some((entry) => entry.outcome === "replay-scheduled")
          ) {
            events.push("replay-commit-storage-failed");
            throw new Error("session-write-failed");
          }
          if (
            next?.workflows?.some((workflow) => workflow.status === "direct-preparing") &&
            !previous?.workflows?.some((workflow) => workflow.status === "direct-preparing")
          ) events.push("direct-claimed");
          if (
            next?.workflows?.some((workflow) => workflow.status === "direct-resuming") &&
            !previous?.workflows?.some((workflow) => workflow.status === "direct-resuming")
          ) events.push("resume-claimed");
          if (
            next?.recent?.some((entry) => entry.outcome === "replay-scheduled") &&
            !previous?.recent?.some((entry) => entry.outcome === "replay-scheduled")
          ) events.push("replay-commit-stored");
          if (
            next?.activationAttempts?.some((attempt) =>
              !previous?.activationAttempts?.some(
                (entry) => entry.tabId === attempt.tabId && entry.version === attempt.version
              )
            )
          ) {
            events.push("activation-attempt-write");
            if (activationAttemptStorageFails) throw new Error("activation-attempt-write-failed");
            activationAttemptWriteHook?.();
            await Promise.resolve();
            await Promise.resolve();
          }
          Object.assign(session, clone(value));
        }
      },
      local: {
        setAccessLevel(details) {
          events.push("local-access-protected");
          assert.deepEqual(details, { accessLevel: "TRUSTED_CONTEXTS" });
          return localAccessFails ? Promise.reject(new Error("protection-failed")) : Promise.resolve();
        },
        async get(key) {
          events.push("local-read");
          if (initialReadHeld) {
            events.push("initial-reconcile-held");
            await initialReadGate;
            initialReadHeld = false;
            events.push("initial-reconcile-released");
          }
          return { [key]: clone(local[key]) };
        },
        async set(value) {
          if (Object.hasOwn(value, RELIABLE_LEDGER_KEY)) {
            events.push("ledger-write-attempt");
            if (ledgerWriteFails) throw new Error("ledger-write-failed");
            events.push("ledger-written");
          }
          Object.assign(local, clone(value));
        },
        async remove(key) {
          events.push(key === LEGACY_RELIABLE_CONTROL_KEY ? "legacy-control-removed" : "ledger-removed");
          delete local[key];
        }
      }
    },
    permissions: {
      async contains(details) {
        assert.deepEqual(details, { permissions: ["contentSettings"] });
        return permissionGranted;
      }
    },
    alarms: {
      onAlarm: { addListener: (listener) => { listeners.alarm = listener; } },
      async create(name, details) {
        events.push(`alarm-created:${name}`);
        alarmCreates.push({ name, details: clone(details) });
        if (alarmCreateFails) throw new Error("alarm-create-failed");
        alarms.set(name, clone(details));
      },
      async clear(name) {
        events.push(`alarm-cleared:${name}`);
        if (alarmClearFails) throw new Error("alarm-clear-failed");
        return alarms.delete(name);
      }
    },
    contentSettings: {
      cookies: {
        async clear(details) {
          cookieClears.push(clone(details));
          events.push("cookies-cleared");
          if (cookieClearFails) throw new Error("cookie-clear-failed");
        },
        async set(details) {
          cookieSets.push(clone(details));
          events.push("cookie-set");
          if (cookieSetFails) throw new Error("cookie-set-failed");
        },
        async get(details) {
          cookieGets.push(clone(details));
          events.push("cookie-get");
          if (cookieGetFails) throw new Error("cookie-get-failed");
          return { setting: effectiveCookieSetting };
        }
      }
    },
    action: {
      async setBadgeBackgroundColor() {},
      async setBadgeText() { events.push("badge-refreshed"); }
    },
    windows: {
      async get(windowId) {
        windowGets.push(windowId);
        events.push(`window-read:${windowId}`);
        if (windowGetFails || !windows.has(windowId)) throw new Error("missing-window");
        windowGetHook?.({ windowId, call: windowGets.length });
        if (!windows.has(windowId)) throw new Error("missing-window");
        return clone(windows.get(windowId));
      },
      async update(windowId, update) {
        windowUpdates.push({ windowId, update: clone(update) });
        if (!windows.has(windowId)) throw new Error("missing-window");
        Object.assign(windows.get(windowId), clone(update));
        return clone(windows.get(windowId));
      }
    },
    tabs: {
      onRemoved: { addListener: (listener) => { listeners.removed = listener; } },
      onActivated: { addListener: (listener) => { listeners.activated = listener; } },
      onUpdated: { addListener: (listener) => { listeners.updated = listener; } },
      async query(details) {
        tabQueries.push(clone(details));
        events.push("tabs-queried");
        if (tabQueryFails) throw new Error("tab-query-failed");
        return [...tabs.values()].filter((tab) => {
          if (details?.active === true && tab.active !== true) return false;
          if (details?.lastFocusedWindow === true && windows.get(tab.windowId)?.focused !== true) return false;
          if (Array.isArray(details?.url) && !isSupportedReportCenterUrl(tab.url)) return false;
          return true;
        }).map(clone);
      },
      async get(tabId) {
        tabGets.push(tabId);
        events.push(`tab-read:${tabId}`);
        if (tabGetFails || !tabs.has(tabId)) throw new Error("missing-tab");
        activationRereadHook?.({ tabId, call: tabGets.length });
        if (!tabs.has(tabId)) throw new Error("missing-tab");
        return clone(tabs.get(tabId));
      },
      async update(tabId, update) {
        if (!tabs.has(tabId)) throw new Error("missing-tab");
        Object.assign(tabs.get(tabId), clone(update));
        return clone(tabs.get(tabId));
      },
      async reload(tabId, details) {
        tabReloads.push({ tabId, details: clone(details) });
        events.push(`tab-reload:${tabId}`);
        if (tabReloadFails || !tabs.has(tabId)) throw new Error("tab-reload-failed");
      },
      async sendMessage(tabId, message, sendOptions) {
        if (message?.type === "sf-activation-probe") {
          assert.deepEqual(Object.keys(message).sort(), ["build", "protocol", "type"]);
          assert.equal(message.build, "1.1.0");
          assert.equal(message.protocol, 1);
          assert.deepEqual(sendOptions, { frameId: 0 });
          activationProbes.push({ tabId, message: clone(message), options: clone(sendOptions) });
          events.push(`activation-probe:${tabId}`);
          await activationProbeHook?.({ tabId, message, options: sendOptions });
          if (activationProbeNeverResolves) return new Promise(() => undefined);
          if (activationProbeFails) throw new Error("no-receiving-end");
          return clone(activationProbeResponse);
        }
        const workflow = session[STATE_KEY]?.workflows?.find(
          (entry) =>
            entry.sourceTabId === tabId &&
            entry.sourceDocumentId === sendOptions?.documentId &&
            entry.resumeAttemptId === message?.resumeAttemptId
        );
        if (!workflow) throw new Error("stale-document");
        if (
          message?.type !== "resume-with-cookie-exception" ||
          Object.keys(message).sort().join("\u0000") !== "resumeAttemptId\u0000type" ||
          !isSafeResumeAttemptId(message.resumeAttemptId)
        ) throw new Error("unexpected-continuation");
        resumes.push({ tabId, message: clone(message), options: clone(sendOptions) });
        events.push("source-resume-requested");
        await resumeHook?.({ tabId, message, options: sendOptions });
        if (resumeResponse?.code === "replay-scheduled" && resumeResponse.replayScheduled === true) {
          const commit = await dispatch(
            { type: "replay-schedule-ready", resumeAttemptId: message.resumeAttemptId },
            sourceSender({
              sourceTabId: workflow.sourceTabId,
              windowId: workflow.sourceWindowId,
              frameId: workflow.sourceFrameId,
              documentId: workflow.sourceDocumentId,
              url: `${workflow.iasOrigin}/saml2/idp/sso/tenant`
            })
          );
          commitResponses.push(clone(commit));
          if (
            commit?.ok === true &&
            commit.code === "replay-schedule-committed" &&
            commit.resumeAttemptId === message.resumeAttemptId
          ) {
            replayCommitAcks += 1;
            events.push("replay-commit-acknowledged");
            if (outerResponseFailsAfterCommit) throw new Error("outer-channel-lost");
            return clone(resumeResponse);
          }
          return {
            ready: true,
            replaySubmitted: false,
            code: "resume-interrupted",
            iasOrigin: IAS_ORIGIN,
            sourceOrigin: SF_ORIGIN
          };
        }
        return clone(resumeResponse);
      }
    }
  };

  function sourceSender(overrides = {}) {
    return {
      id: fakeChrome.runtime.id,
      tab: {
        id: overrides.sourceTabId ?? 10,
        windowId: overrides.windowId ?? 1,
        incognito: false
      },
      frameId: overrides.frameId ?? 7,
      documentId: overrides.documentId ?? "source-doc-1",
      url: overrides.url ?? IAS_FRAME_URL
    };
  }

  function activationSender(overrides = {}) {
    const tabId = overrides.tabId ?? 20;
    const current = tabs.get(tabId) || makeStoryTab({ id: tabId });
    return {
      id: overrides.senderId ?? fakeChrome.runtime.id,
      tab: {
        ...clone(current),
        windowId: overrides.windowId ?? current.windowId,
        incognito: overrides.incognito ?? current.incognito
      },
      frameId: overrides.frameId ?? 0,
      documentId: overrides.documentId ?? "story-document-after-reload",
      url: overrides.url ?? current.url
    };
  }

  function dispatch(message, sender) {
    return new Promise((resolve, reject) => {
      try {
        const keepOpen = listeners.message?.(clone(message), clone(sender), resolve);
        if (keepOpen !== true) resolve(undefined);
      } catch (error) {
        reject(error);
      }
    });
  }

  globalThis.chrome = fakeChrome;
  await import(`../src/background.js?test=${Date.now()}-${Math.random()}`);

  let coldResult;
  let coldEvents = [];
  if (options.coldDetection) {
    const pending = dispatch(
      { type: "interstitial-detected", sourceOrigin: SF_ORIGIN },
      sourceSender()
    );
    await Promise.resolve();
    await Promise.resolve();
    coldEvents = [...events];
    releaseInitialRead?.();
    coldResult = await pending;
  } else {
    releaseInitialRead?.();
  }

  await until(() =>
    listeners.message &&
    listeners.removed &&
    listeners.activated &&
    listeners.updated &&
    listeners.alarm &&
    listeners.startup &&
    listeners.installed &&
    session[STATE_KEY]
  );
  if (!options.coldDetection) {
    await until(() => events.includes("badge-refreshed"));
    await settle();
  }
  const startupEvents = [...events];

  const harness = {
    chrome: fakeChrome,
    local,
    alarms,
    events,
    resumes,
    cookieClears,
    cookieSets,
    cookieGets,
    alarmCreates,
    commitResponses,
    tabQueries,
    tabGets,
    tabReloads,
    windowGets,
    windowUpdates,
    activationProbes,
    coldResult,
    coldEvents,
    startupEvents,
    get replayCommitAcks() { return replayCommitAcks; },
    state: () => clone(session[STATE_KEY]),
    setState(value) { session[STATE_KEY] = clone(value); },
    setPermission(value) { permissionGranted = value; },
    setEffectiveCookieSetting(value) { effectiveCookieSetting = value; },
    setLocalAccessFails(value) { localAccessFails = value; },
    setLedgerWriteFails(value) { ledgerWriteFails = value; },
    setAlarmCreateFails(value) { alarmCreateFails = value; },
    setAlarmClearFails(value) { alarmClearFails = value; },
    setCookieClearFails(value) { cookieClearFails = value; },
    setCookieSetFails(value) { cookieSetFails = value; },
    setCookieGetFails(value) { cookieGetFails = value; },
    setCommitStorageFails(value) { commitStorageFails = value; },
    setOuterResponseFailsAfterCommit(value) { outerResponseFailsAfterCommit = value; },
    setResumeHook(value) { resumeHook = value; },
    setResumeResponse(value) { resumeResponse = clone(value); },
    setActivationProbeResponse(value) { activationProbeResponse = clone(value); },
    setActivationProbeFails(value) { activationProbeFails = value; },
    setActivationProbeNeverResolves(value) { activationProbeNeverResolves = value; },
    setActivationProbeHook(value) { activationProbeHook = value; },
    setActivationRereadHook(value) { activationRereadHook = value; },
    setActivationAttemptWriteHook(value) { activationAttemptWriteHook = value; },
    setActivationAttemptStorageFails(value) { activationAttemptStorageFails = value; },
    setTabQueryFails(value) { tabQueryFails = value; },
    setTabGetFails(value) { tabGetFails = value; },
    setTabReloadFails(value) { tabReloadFails = value; },
    setWindowGetFails(value) { windowGetFails = value; },
    setWindowGetHook(value) { windowGetHook = value; },
    setManifestVersion(value) { manifestVersion = value; },
    setTab(tab) { tabs.set(tab.id, clone(tab)); },
    setWindow(browserWindow) { windows.set(browserWindow.id, clone(browserWindow)); },
    removeTab(tabId) { tabs.delete(tabId); },
    resetTrace() {
      events.length = 0;
      resumes.length = 0;
      cookieClears.length = 0;
      cookieSets.length = 0;
      cookieGets.length = 0;
      alarmCreates.length = 0;
      commitResponses.length = 0;
      tabQueries.length = 0;
      tabGets.length = 0;
      tabReloads.length = 0;
      windowGets.length = 0;
      windowUpdates.length = 0;
      activationProbes.length = 0;
      replayCommitAcks = 0;
    },
    detect(overrides = {}) {
      return dispatch(
        { type: "interstitial-detected", sourceOrigin: overrides.sourceOrigin || SF_ORIGIN },
        sourceSender(overrides)
      );
    },
    activationReady(overrides = {}) {
      return dispatch(
        overrides.message || {
          type: "sf-activation-ready",
          build: "1.1.0",
          protocol: 1
        },
        activationSender(overrides)
      );
    },
    commit(resumeAttemptId, overrides = {}) {
      return dispatch(
        { type: "replay-schedule-ready", resumeAttemptId },
        sourceSender(overrides)
      );
    },
    popup(type) {
      return dispatch(
        { type },
        { id: fakeChrome.runtime.id, url: fakeChrome.runtime.getURL("src/popup.html") }
      );
    },
    popupMessage(message) {
      return dispatch(
        message,
        { id: fakeChrome.runtime.id, url: fakeChrome.runtime.getURL("src/popup.html") }
      );
    },
    popupTab(message, overrides = {}) {
      const popupUrl = fakeChrome.runtime.getURL("src/popup.html");
      return dispatch(message, {
        id: fakeChrome.runtime.id,
        url: overrides.senderUrl || popupUrl,
        frameId: overrides.frameId || 0,
        tab: {
          id: 11,
          windowId: 1,
          incognito: overrides.incognito === true,
          url: overrides.tabUrl || popupUrl
        }
      });
    },
    contentMessage(message) {
      return dispatch(message, sourceSender());
    },
    fireInstalled(reason) { listeners.installed?.({ reason }); },
    fireActivated(tabId, windowId = 1) { listeners.activated?.({ tabId, windowId }); },
    fireUpdated(tabId, changeInfo, tab = tabs.get(tabId)) {
      listeners.updated?.(tabId, clone(changeInfo), clone(tab));
    },
    fireRemoved(tabId) {
      tabs.delete(tabId);
      listeners.removed?.(tabId, { windowId: 1, isWindowClosing: false });
    },
    fireAlarm() { listeners.alarm?.({ name: RELIABLE_ALARM_NAME, scheduledTime: Date.now() }); },
    fireStartup() { listeners.startup?.(); },
    async restart() {
      const badgeCount = events.filter((event) => event === "badge-refreshed").length;
      await import(`../src/background.js?restart=${Date.now()}-${Math.random()}`);
      await until(() =>
        events.filter((event) => event === "badge-refreshed").length > badgeCount
      );
      await settle();
    },
    until
  };
  return harness;
}

async function until(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function settle(milliseconds = 10) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}
