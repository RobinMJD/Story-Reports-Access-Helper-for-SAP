import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = loadPlaywright();
const edgeExecutable = findEdgeExecutable();
const extension = prepareExtensionRoot();
const runHeaded = /^(?:1|true|yes)$/i.test(String(process.env.SMOKE_HEADED || ""));
const STATE_KEY = "sapIasStorageAccessWorkflows.v9";
const RELIABLE_LEDGER_KEY = "sapIasCookieExceptionLedger.v1";
const LEGACY_RELIABLE_CONTROL_KEY = "sapIasReliableModeControl.v1";
const RELIABLE_ALARM_NAME = "sapIasCookieExceptionExpiry.v1";
const SAP_KB_URL = "https://userapps.support.sap.com/sap/support/knowledge/en/3039244";
const QUIESCENCE_MS = 1_500;

let fixture;
let profile;
let edge;
let recoveryProfile;
let recoveryEdge;
let manualProfile;
let manualEdge;

try {
  assertSmokeArchitecture(extension.root);
  fixture = await startFixtureServer();

  recoveryProfile = mkdtempSync(join(tmpdir(), "sap-story-helper-edge-v101-recovery-"));
  configureBlockedCookieProfile(recoveryProfile);
  recoveryEdge = await launchEdge(recoveryProfile);
  await runPreExistingStoryRecoveryAfterExtensionReload(recoveryEdge);
  assert.deepEqual(recoveryEdge.runtimeErrors, [], formatRuntimeErrors(recoveryEdge.runtimeErrors));
  await recoveryEdge.context.close();
  recoveryEdge = null;
  rmSync(recoveryProfile, { recursive: true, force: true });
  recoveryProfile = null;
  console.log("PASS: a pre-existing Report Center home page was recovered at worker start with one route-preserving reload.");

  fixture.reset();
  manualProfile = mkdtempSync(join(tmpdir(), "sap-story-helper-edge-v101-manual-"));
  configureBlockedCookieProfile(manualProfile);
  manualEdge = await launchEdge(manualProfile);
  await runManualFixOnCurrentReportCenter(manualEdge);
  assert.deepEqual(manualEdge.runtimeErrors, [], formatRuntimeErrors(manualEdge.runtimeErrors));
  await manualEdge.context.close();
  manualEdge = null;
  rmSync(manualProfile, { recursive: true, force: true });
  manualProfile = null;
  console.log("PASS: Fix this report performed one bounded ordinary reload and rejected an immediate duplicate.");

  fixture.reset();
  profile = mkdtempSync(join(tmpdir(), "sap-story-helper-edge-v101-"));
  configureBlockedCookieProfile(profile);

  edge = await launchEdge(profile);
  await runCompactPopupStates(edge);
  console.log("PASS: the plain-language popup distinguishes not fixed, refreshing, fixing, prepared, fixed, and failed states.");

  await runTopLevelHelperUntouched(edge);
  await runInertSources(edge);
  console.log("PASS: top-level SAP helper, unapproved ancestor, stale document, and malformed interstitial remained inert.");

  const first = await runDirectAttempt(edge, fixture.firstStoryUrl);
  console.log("PASS: blocked third-party storage gained one exact allowance and durably scheduled one same-frame native POST.");

  await first.popup.close();
  await first.source.close();

  assert.deepEqual(edge.runtimeErrors, [], formatRuntimeErrors(edge.runtimeErrors));
  await edge.context.close();
  edge = null;

  edge = await launchEdge(profile);
  await assertAutomaticStateAfterRestart(edge);
  console.log("PASS: the exact allowance remained bounded and effective after restart, with no legacy control state.");

  assert.deepEqual(edge.runtimeErrors, [], formatRuntimeErrors(edge.runtimeErrors));
  console.log(
    `Loaded Microsoft Edge v1.1.0 recovery and direct-flow smoke passed with ${edgeExecutable}` +
      (extension.fromZip ? ` using exact ZIP ${extension.archive}.` : " from the source tree.")
  );
} finally {
  await recoveryEdge?.context.close().catch(() => undefined);
  await manualEdge?.context.close().catch(() => undefined);
  await edge?.context.close().catch(() => undefined);
  await fixture?.close();
  extension.cleanup();
  if (recoveryProfile) rmSync(recoveryProfile, { recursive: true, force: true });
  if (manualProfile) rmSync(manualProfile, { recursive: true, force: true });
  if (profile) rmSync(profile, { recursive: true, force: true });
}

async function runCompactPopupStates({ context, extensionOrigin }) {
  await assertInitialCheckingPopup(context);

  const popup = await openPopup(context, extensionOrigin, "No fix applied yet");
  assert.equal(await containsRequiredPermission(popup), true, "contentSettings must be granted as a required permission at load");
  assert.equal(await popup.locator("#status-detail").textContent(), "Open SAP Report Center to get started.");
  assert.equal(await popup.locator("#fix-report").textContent(), "Fix this report");
  assert.equal(await popup.locator("#fix-report").isDisabled(), true);
  assert.equal(await popup.locator("#fix-action").isHidden(), true);
  assert.equal(await popup.locator("#fix-guidance").textContent(), "Use this if the Story Report stays blank.");
  assert.equal(await popup.locator("#sap-help").textContent(), "Open SAP help article");
  await assertCompactPlainPopup(popup);
  await assertSapHelpAction(popup);

  await renderPopupStateForSmoke(popup, "idle", true);
  await waitForPopupTitle(popup, "No fix applied yet");
  assert.equal(await popup.locator("#status-detail").textContent(), "Open a Story Report. Help starts automatically if it is needed.");
  assert.equal(await popup.locator("#fix-report").isDisabled(), false);
  assert.equal(await popup.locator("#fix-action").isVisible(), true);
  await assertCompactPlainPopup(popup);

  await renderPopupStateForSmoke(popup, "page-refreshing", false);
  await waitForPopupTitle(popup, "Refreshing SAP…");
  assert.equal(await popup.locator("#status-detail").textContent(), "The page is being prepared. Please wait.");
  assert.equal(await popup.locator("#fix-action").isHidden(), true);
  await assertCompactPlainPopup(popup);

  await renderPopupStateForSmoke(popup, "manual-refresh-started", false);
  await waitForPopupTitle(popup, "Refresh started");
  assert.equal(await popup.locator("#status-detail").textContent(), "Open the Story Report again when SAP is ready.");
  await assertCompactPlainPopup(popup);

  await renderPopupStateForSmoke(popup, "continuation-in-progress", false);
  await waitForPopupTitle(popup, "Applying the fix…");
  assert.equal(await popup.locator("#status-detail").textContent(), "Please wait a few seconds.");
  await assertCompactPlainPopup(popup);

  await renderPopupStateForSmoke(popup, "page-prepared", false);
  await waitForPopupTitle(popup, "SAP page prepared");
  assert.equal(await popup.locator("#status-detail").textContent(), "Open the Story Report again. Help will continue automatically.");
  await assertCompactPlainPopup(popup);

  await renderPopupStateForSmoke(popup, "replay-scheduled", false);
  await waitForPopupTitle(popup, "Fix applied");
  assert.equal(await popup.locator("#status-detail").textContent(), "The browser fix is active. Return to your report.");
  assert.equal(await popup.locator("#fix-action").isHidden(), true);
  await assertCompactPlainPopup(popup);

  await renderPopupStateForSmoke(popup, "automatic-fix-blocked", true);
  await waitForPopupTitle(popup, "Fix not applied");
  assert.equal(await popup.locator("#status-detail").textContent(), "Use Fix this report, then open the Story again.");
  assert.equal(await popup.locator("#fix-action").isVisible(), true);
  await assertCompactPlainPopup(popup);

  await renderPopupStateForSmoke(popup, "check-unavailable", false);
  await waitForPopupTitle(popup, "Status unavailable");
  assert.equal(await popup.locator("#status-detail").textContent(), "If the report is blank, you can still try the fix.");
  assert.equal(await popup.locator("#fix-action").isVisible(), true);
  await assertCompactPlainPopup(popup);

  await popup.close();
}

async function assertInitialCheckingPopup(context) {
  const popup = await context.newPage();
  const html = readFileSync(join(extension.root, "src/popup.html"), "utf8")
    .replace('<link rel="stylesheet" href="popup.css">', `<style>${readFileSync(join(extension.root, "src/popup.css"), "utf8")}</style>`)
    .replace('<script src="popup.js"></script>', "");
  await popup.setContent(html);
  assert.equal(await popup.locator("#status-title").textContent(), "Checking this page…");
  assert.equal(await popup.locator("#status-detail").textContent(), "Please wait a moment.");
  assert.equal(await popup.locator("#status-card").getAttribute("aria-busy"), "true");
  assert.equal(await popup.locator("#fix-action").isHidden(), true);
  const animationName = await popup.locator("#status-dot").evaluate((dot) => getComputedStyle(dot).animationName);
  assert.equal(animationName, "status-pulse", "the initial checking indicator must be visibly animated");
  await popup.close();
}

async function assertSapHelpAction(popup) {
  await popup.evaluate(() => {
    const original = chrome.tabs.create;
    globalThis.__restoreSapHelpCreate = () => { chrome.tabs.create = original; };
    chrome.tabs.create = (details) => {
      globalThis.__capturedSapHelpCreate = details;
      return Promise.resolve();
    };
  });
  await popup.locator("#sap-help").click();
  const captured = await popup.evaluate(() => {
    const details = globalThis.__capturedSapHelpCreate || null;
    globalThis.__restoreSapHelpCreate?.();
    delete globalThis.__capturedSapHelpCreate;
    delete globalThis.__restoreSapHelpCreate;
    return details;
  });
  assert.deepEqual(captured, { url: SAP_KB_URL }, "the visible help button must request only the fixed public SAP KBA");
}

async function runPreExistingStoryRecoveryAfterExtensionReload(edgeInstance) {
  const { context, extensionOrigin } = edgeInstance;

  fixture.reset();
  const source = await context.newPage();
  await source.goto(fixture.activationHomeUrl);
  const originalFrame = await waitForFrame(source, fixture.dormantFrameUrl);
  const initialAccess = await readStorageAccessState(originalFrame);
  assert.equal(initialAccess.hasAccess, false, "the pre-existing Story must begin with blocked third-party storage");
  await waitPastDetectionWindow();
  await assertQuiescent(fixture);
  assert.equal(fixture.sourceRequests, 1);
  assert.equal(fixture.analyticsRequests, 1);
  assert.equal(fixture.iasInitialRequests, 1);
  assert.equal(fixture.iasReplayRequests, 0, "the pre-existing document must remain failed before extension reload recovery");
  assert.equal(fixture.helperRequests, 0);
  assert.notEqual(await getEffectiveCookieSetting(context, extensionOrigin), "allow");

  await seedLegacyPauseMarker(context, extensionOrigin);
  await source.bringToFront();
  const sentinel = await probeActiveStorySentinel(edgeInstance.serviceWorker);
  assert.deepEqual(sentinel.response, {
    type: "sf-activation-current",
    build: "1.1.0",
    protocol: 1
  });
  assert.ok(Number.isInteger(sentinel.tabId) && sentinel.tabId > 0);
  assert.equal(sentinel.url, fixture.activationHomeUrl);
  await assertQuiescent(fixture);

  const spaBefore = await captureSpaState(source);
  const pagesBeforeReload = [...context.pages()];
  fixture.armActivationRecovery();
  const replayBarrier = fixture.holdNextReplay();
  edgeInstance.serviceWorker = await reloadExtensionContext(context, edgeInstance.serviceWorker);
  await waitUntil(() => legacyPauseMarkerIsAbsent(edgeInstance.serviceWorker));

  await waitUntil(() => fixture.sourceRequests === 2 && fixture.iasInitialRequests === 2, 8_000);
  await waitForReplayBarrier(replayBarrier);
  const spaAfter = await captureSpaState(source);

  assert.deepEqual(context.pages(), pagesBeforeReload, "extension reload recovery must reuse the exact existing tab");
  assert.equal(spaAfter.url, spaBefore.url, "the Report Center home route and hash must be preserved");
  assert.deepEqual(spaAfter.historyState, spaBefore.historyState, "the SAP route state must be reconstructed unchanged");
  assert.deepEqual(spaAfter.shellState, spaBefore.shellState, "the same Story shell state must be reconstructed");
  assert.notEqual(spaAfter.documentNonce, spaBefore.documentNonce, "one ordinary reload must create one fresh document");
  assert.notEqual(spaAfter.navigationTimeOrigin, spaBefore.navigationTimeOrigin, "one ordinary reload must replace the document");
  assert.equal(fixture.sourceRequests, 2, "the existing Report Center home page must receive exactly one recovery reload");
  assert.equal(fixture.analyticsRequests, 2);
  assert.equal(fixture.iasInitialRequests, 2);
  assert.equal(fixture.iasReplayRequests, 1, "the reloaded Report Center page must schedule exactly one native IAS POST");
  assert.equal(fixture.helperRequests, 0, "install recovery must not open a helper tab");
  assert.equal(fixture.unexpectedIasMethods, 0);

  const preparedPopup = await openPopup(context, extensionOrigin, "SAP is still loading", source);
  const loadingStatus = await getStatus(preparedPopup);
  assert.equal(loadingStatus.ok, true);
  assert.equal(loadingStatus.code, "page-not-ready");
  const recentResults = await readRecentResults(preparedPopup);
  assert.equal(recentResults.at(-1)?.outcome, "replay-scheduled", "durable fix state must exist before the held POST is released");
  const activationAttempts = await readActivationAttempts(preparedPopup);
  assert.equal(activationAttempts.length, 1, "one terminal recovery marker must prevent any second reload");
  assert.deepEqual(Object.keys(activationAttempts[0]).sort(), ["at", "phase", "tabId", "version"]);
  assert.equal(activationAttempts[0].tabId, sentinel.tabId);
  assert.equal(activationAttempts[0].version, "1.1.0");
  assert.equal(activationAttempts[0].phase, "reload-attempted");
  assert.ok(Number.isSafeInteger(activationAttempts[0].at) && activationAttempts[0].at > 0);
  assert.doesNotMatch(JSON.stringify(activationAttempts[0]), /https?:|successfactors|accounts/i);
  assert.equal(await getEffectiveCookieSettingFromPopup(preparedPopup), "allow");

  const recoveredFrame = source.frames().find((frame) => frame.url() === fixture.frameUrl);
  assert.ok(recoveredFrame, "the reloaded Story must contain the IAS frame that owns the held POST");
  replayBarrier.release();
  await recoveredFrame.locator("#ias-replay-result").waitFor({ state: "attached", timeout: 5_000 });
  assert.equal(await recoveredFrame.locator("#ias-replay-result").textContent(), "IAS replay accepted");
  await source.waitForLoadState("load");
  await source.bringToFront();
  await preparedPopup.reload();
  await waitForPopupTitle(preparedPopup, "Fix applied");
  const preparedStatus = await getStatus(preparedPopup);
  assert.equal(preparedStatus.ok, true);
  assert.equal(preparedStatus.code, "replay-scheduled");
  await preparedPopup.close();

  await source.bringToFront();
  await source.evaluate(() => {
    location.hash = "#/story/execute/action";
  });
  await waitUntil(() => source.url().endsWith("#/story/execute/action"));
  await assertQuiescent(fixture);
  assert.equal(fixture.sourceRequests, 2, "same-tab Story routing after recovery must not cause a second reload");
  assert.equal(fixture.iasReplayRequests, 1, "same-tab Story routing after recovery must not cause a duplicate IAS POST");

  await source.close();
}

async function runManualFixOnCurrentReportCenter({ context, extensionOrigin }) {
  fixture.reset();
  const source = await context.newPage();
  await source.goto(fixture.activationHomeUrl);
  await waitForFrame(source, fixture.dormantFrameUrl);
  await waitPastDetectionWindow();
  await assertQuiescent(fixture);
  assert.equal(fixture.sourceRequests, 1, "a current activation sentinel must prevent an automatic reload");
  assert.equal(fixture.iasReplayRequests, 0);

  await source.evaluate(() => {
    location.hash = "#/story/execute/action";
  });
  await waitUntil(() => source.url().endsWith("#/story/execute/action"));
  await assertQuiescent(fixture);
  assert.equal(fixture.sourceRequests, 1, "same-tab routing with a current sentinel must remain reload-free");

  const popup = await context.newPage();
  await popup.goto(`${extensionOrigin}/src/popup.html`);
  await source.bringToFront();
  await popup.reload();
  await waitForPopupTitle(popup, "No fix applied yet");
  assert.equal(await popup.locator("#fix-report").isDisabled(), false, "the manual action must be available only on Report Center");
  assert.equal(await popup.locator("#fix-guidance").textContent(), "Use this if the Story Report stays blank.");

  fixture.armActivationRecovery();
  const replayBarrier = fixture.holdNextReplay();
  await popup.locator("#fix-report").click();
  await waitForPopupTitle(popup, "Refresh started");
  assert.equal(await popup.locator("#status-detail").textContent(), "Open the Story Report again when SAP is ready.");
  assert.equal(fixture.sourceRequests, 1, "the accepted result must render before the delayed reload starts");
  await waitUntil(() => fixture.sourceRequests === 2 && fixture.iasInitialRequests === 2, 8_000);
  await waitForReplayBarrier(replayBarrier);

  await source.bringToFront();
  const whileLoading = await sendPopupMessage(popup, { type: "force-fix-current-tab" });
  assert.equal(whileLoading?.ok, true);
  assert.equal(whileLoading?.code, "page-not-ready");
  await assertQuiescent(fixture);
  assert.equal(fixture.sourceRequests, 2, "an immediate repeated manual request must not reload again");
  assert.equal(fixture.iasReplayRequests, 1, "an immediate repeated manual request must not duplicate the IAS POST");

  replayBarrier.release();
  const recoveredFrame = source.frames().find((frame) => frame.url() === fixture.frameUrl);
  assert.ok(recoveredFrame, "the manual reload must retain the recovering IAS frame");
  await recoveredFrame.locator("#ias-replay-result").waitFor({ state: "attached", timeout: 5_000 });
  await source.waitForLoadState("load");
  await source.bringToFront();
  await popup.reload();
  await waitForPopupTitle(popup, "Fix applied");
  const duplicate = await sendPopupMessage(popup, { type: "force-fix-current-tab" });
  assert.equal(duplicate?.ok, true);
  assert.equal(duplicate?.code, "fix-already-applied");
  assert.equal(fixture.sourceRequests, 2, "an already-applied fix must not reload again");
  await popup.close();
  await source.close();
}

async function probeActiveStorySentinel(serviceWorker) {
  return serviceWorker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !Number.isInteger(tab.id)) return { tabId: null, url: tab?.url || null, response: null };
    try {
      const response = await chrome.tabs.sendMessage(
        tab.id,
        { type: "sf-activation-probe", build: "1.1.0", protocol: 1 },
        { frameId: 0 }
      );
      return { tabId: tab.id, url: tab.url || null, response: response || null };
    } catch {
      return { tabId: tab.id, url: tab.url || null, response: null };
    }
  });
}

async function reloadExtensionContext(context, serviceWorker) {
  const serviceWorkerUrl = serviceWorker.url();
  const replacement = context.waitForEvent("serviceworker", {
    predicate: (candidate) => candidate !== serviceWorker && candidate.url() === serviceWorkerUrl,
    timeout: 8_000
  });
  await serviceWorker.evaluate(() => {
    setTimeout(() => chrome.runtime.reload(), 0);
    return true;
  });
  return replacement;
}

async function seedLegacyPauseMarker(context, extensionOrigin) {
  const popup = await context.newPage();
  await popup.goto(`${extensionOrigin}/src/popup.html`);
  const stored = await popup.evaluate(async (key) => {
    await chrome.storage.local.set({
      [key]: { version: 2, status: "paused", updatedAt: Date.now() }
    });
    const snapshot = await chrome.storage.local.get(key);
    return Object.hasOwn(snapshot, key);
  }, LEGACY_RELIABLE_CONTROL_KEY);
  assert.equal(stored, true, "the migration fixture must seed the exact historical control key");
  await popup.close();
}

async function legacyPauseMarkerIsAbsent(serviceWorker) {
  return serviceWorker.evaluate(async (key) => {
    const stored = await chrome.storage.local.get(key);
    return !Object.hasOwn(stored, key);
  }, LEGACY_RELIABLE_CONTROL_KEY);
}

async function runTopLevelHelperUntouched({ context, extensionOrigin }) {
  fixture.reset();
  const helper = await context.newPage();
  await helper.goto(fixture.helperUrl);
  await helper.locator("#interactStorageAccess").waitFor({ state: "visible" });
  await helper.locator("#interactStorageAccess").click();
  await waitUntil(() => fixture.helperNativeBeacons === 1);
  assert.equal(
    await helper.locator("html").getAttribute("data-native-click"),
    "handled",
    "the extension must not intercept the top-level SAP helper click"
  );
  await assertQuiescent(fixture);
  assert.equal(fixture.helperRequests, 1);
  assert.equal(fixture.iasReplayRequests, 0);
  assert.notEqual(await getEffectiveCookieSetting(context, extensionOrigin), "allow");
  await helper.close();
}

async function runInertSources({ context, extensionOrigin }) {
  fixture.reset();
  const unapproved = await context.newPage();
  await unapproved.goto(fixture.unapprovedStoryUrl);
  await waitUntil(() => fixture.iasInitialRequests === 1);
  await waitPastDetectionWindow();
  await assertQuiescent(fixture);
  assert.equal(fixture.iasReplayRequests, 0, "an unapproved top-level ancestor must not trigger a POST");
  assert.equal(fixture.helperRequests, 0);
  assert.notEqual(await getEffectiveCookieSetting(context, extensionOrigin, fixture.unapprovedOrigin), "allow");
  await unapproved.close();

  fixture.reset();
  const malformed = await context.newPage();
  await malformed.goto(fixture.malformedStoryUrl);
  await waitUntil(() => fixture.malformedIasRequests === 1);
  await waitPastDormantDetectionWindow();
  await assertQuiescent(fixture);
  assert.equal(fixture.iasReplayRequests, 0, "a malformed form schema must not trigger a POST");
  assert.equal(fixture.helperRequests, 0);
  assert.notEqual(await getEffectiveCookieSetting(context, extensionOrigin), "allow");
  await malformed.close();

  fixture.reset();
  const stale = await context.newPage();
  await stale.goto(fixture.staleStoryUrl);
  await waitUntil(() => fixture.iasInitialRequests === 1 && fixture.staleIasRequests === 1);
  await waitPastDetectionWindow();
  await assertQuiescent(fixture);
  assert.equal(fixture.iasReplayRequests, 0, "a replaced IAS document must not trigger a POST");
  assert.equal(fixture.helperRequests, 0);
  assert.notEqual(await getEffectiveCookieSetting(context, extensionOrigin), "allow");
  await stale.close();
}

async function runDirectAttempt({ context, extensionOrigin }, storyUrl) {
  fixture.reset();
  fixture.armActivationRecovery();
  const replayBarrier = fixture.holdNextReplay();
  const source = await context.newPage();
  const pageCountBefore = context.pages().length;
  await source.goto(storyUrl);
  const spaBefore = await captureSpaState(source);
  const iasFrame = await waitForIasFrame(source, fixture.frameUrl);
  const initialAccess = await readStorageAccessState(iasFrame);
  assert.equal(initialAccess.hasAccess, false, "the fixture must begin under blocked third-party storage");

  await waitForReplayBarrier(replayBarrier);
  assert.equal(fixture.iasReplayRequests, 1, "only one native IAS POST may start");
  assert.equal(context.pages().length, pageCountBefore, "automatic continuation must not create a helper or other tab");
  assert.equal(source.frames().includes(iasFrame), true, "the exact original IAS frame must own the held POST");
  assert.equal(iasFrame.url(), fixture.frameUrl);

  const popup = await openPopup(context, extensionOrigin, "SAP is still loading", source);
  const loadingStatus = await getStatus(popup);
  assert.equal(loadingStatus.ok, true);
  assert.equal(loadingStatus.code, "page-not-ready");
  assert.equal(loadingStatus.activeCount, 0);
  const recentResults = await readRecentResults(popup);
  assert.equal(recentResults.at(-1)?.outcome, "replay-scheduled", "durable status must exist before the held POST is released");
  assert.equal(await popup.locator("#sap-help").textContent(), "Open SAP help article");
  await assertCompactPlainPopup(popup);
  assert.equal(await getEffectiveCookieSettingFromPopup(popup), "allow", "the exact IAS/SF pair must be effective");

  replayBarrier.release();
  await iasFrame.locator("#ias-replay-result").waitFor({ state: "attached", timeout: 5_000 });
  assert.equal(await iasFrame.locator("#ias-replay-result").textContent(), "IAS replay accepted");
  await source.waitForLoadState("load");
  await source.bringToFront();
  await popup.reload();
  await waitForPopupTitle(popup, "Fix applied");
  const status = await getStatus(popup);
  assert.equal(status.ok, true);
  assert.equal(status.code, "replay-scheduled");
  assert.equal(await popup.locator("#status-detail").textContent(), "The browser fix is active. Return to your report.");
  assert.equal(source.frames().includes(iasFrame), true, "the same nested frame must receive the POST response");
  await assertQuiescent(fixture);

  assert.equal(fixture.sourceRequests, 1, "the SuccessFactors shell must load exactly once");
  assert.equal(fixture.analyticsRequests, 1, "the hidden analytics intermediary must load exactly once");
  assert.equal(fixture.iasInitialRequests, 1, "the IAS interstitial GET must load exactly once");
  assert.equal(fixture.iasReplayRequests, 1, "the native IAS form must POST exactly once");
  assert.equal(fixture.helperRequests, 0, "direct mode must not open the SAP helper");
  assert.equal(fixture.unexpectedIasMethods, 0);
  assert.deepEqual(await captureSpaState(source), spaBefore, "the top-level SPA route and document must not reload");
  assert.equal(context.pages().length, pageCountBefore + 1, "only the smoke-opened popup may be added");
  return { popup, source };
}

async function assertAutomaticStateAfterRestart({ context, extensionOrigin }) {
  const popup = await openPopup(context, extensionOrigin, "No fix applied yet");
  const status = await getStatus(popup);
  assert.equal(status.ok, true);
  assert.equal(status.code, "unsupported-page");
  assert.equal(status.activeCount, 0);
  assert.equal(await containsRequiredPermission(popup), true);
  assert.equal(await getEffectiveCookieSettingFromPopup(popup), "allow");

  const durable = await readDurableAutomaticState(popup);
  assert.equal(durable.legacyControlPresent, false, "startup must not retain the historical Pause marker");
  assert.equal(durable.alarmPresent, true, "the bounded allowance must retain its expiry alarm");
  assert.equal(durable.ledger?.version, 1);
  assert.equal(durable.ledger?.entries?.length, 1);
  const [entry] = durable.ledger.entries;
  assert.equal(entry.iasOrigin, fixture.iasOrigin);
  assert.equal(entry.sourceOrigin, fixture.sfOrigin);
  assert.ok(Number.isSafeInteger(entry.createdAt) && Number.isSafeInteger(entry.expiresAt));
  assert.ok(entry.expiresAt > Date.now(), "the persisted exact allowance must not already be expired");
  assert.equal(entry.expiresAt - entry.createdAt, 60 * 60 * 1000, "the exact allowance must retain the hard one-hour TTL");
  await assertCompactPlainPopup(popup);
  await popup.close();
}

async function launchEdge(userDataDir) {
  const args = [
    `--disable-extensions-except=${extension.root}`,
    `--load-extension=${extension.root}`,
    `--host-resolver-rules=${fixture.hostRules}`,
    "--no-proxy-server",
    "--block-third-party-cookies",
    "--test-third-party-cookie-phaseout"
  ];
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: edgeExecutable,
    headless: !runHeaded,
    ignoreHTTPSErrors: true,
    args
  });
  const runtimeErrors = [];
  const watchPage = (page) => page.on("pageerror", (error) => runtimeErrors.push(error.message));
  context.on("page", watchPage);
  context.on("weberror", (event) => runtimeErrors.push(event.error()?.message || String(event)));
  for (const page of context.pages()) watchPage(page);

  await waitUntil(
    () => context.serviceWorkers().some((worker) => worker.url().startsWith("chrome-extension://")),
    8_000
  );
  const serviceWorker = context.serviceWorkers().find((worker) => worker.url().startsWith("chrome-extension://"));
  const serviceWorkerUrl = new URL(serviceWorker.url());
  const extensionOrigin = `${serviceWorkerUrl.protocol}//${serviceWorkerUrl.host}`;
  assert.equal(await serviceWorker.evaluate(() => chrome.runtime.getManifest().version), "1.1.0");
  return { context, extensionOrigin, runtimeErrors, serviceWorker };
}

function configureBlockedCookieProfile(userDataDir) {
  const defaultProfile = join(userDataDir, "Default");
  mkdirSync(defaultProfile, { recursive: true });
  writeFileSync(
    join(defaultProfile, "Preferences"),
    JSON.stringify({ profile: { block_third_party_cookies: true, cookie_controls_mode: 1 } }),
    "utf8"
  );
}

async function openPopup(context, extensionOrigin, expectedTitle, activePage = null) {
  const popup = await context.newPage();
  await popup.goto(`${extensionOrigin}/src/popup.html`);
  if (activePage) {
    await activePage.bringToFront();
    await popup.reload();
  }
  await waitForPopupTitle(popup, expectedTitle);
  return popup;
}

async function waitForPopupTitle(popup, expectedTitle) {
  let observedTitle = null;
  try {
    await waitUntil(async () => {
      observedTitle = await popup.locator("#status-title").textContent();
      return observedTitle === expectedTitle;
    });
  } catch {
    throw new Error(`Timed out waiting for popup title ${JSON.stringify(expectedTitle)}; observed ${JSON.stringify(observedTitle)}.`);
  }
}

async function assertCompactPlainPopup(popup) {
  const surface = await popup.evaluate(() => ({
    width: document.body.getBoundingClientRect().width,
    height: document.body.scrollHeight,
    text: document.body.innerText,
    statusCards: document.querySelectorAll(".status-card").length,
    inputs: document.querySelectorAll("input, select, textarea").length,
    buttons: Array.from(document.querySelectorAll("button"), (button) => ({ id: button.id, text: button.textContent.trim() }))
  }));
  assert.equal(surface.width, 392);
  assert.ok(surface.height <= 460, `popup must remain clear without excessive height, observed ${surface.height}px`);
  assert.equal(surface.statusCards, 1);
  assert.equal(surface.inputs, 0);
  assert.deepEqual(surface.buttons, [
    { id: "fix-report", text: "Fix this report" },
    { id: "sap-help", text: "Open SAP help article" }
  ]);
  assert.doesNotMatch(surface.text, /\b(?:IAS|contentSettings|cookie|origin|replay|durable)\b/i);
  assert.doesNotMatch(surface.text, /\b(?:pause|resume)\b/i);
}

async function renderPopupStateForSmoke(popup, code, canFixCurrentPage) {
  await popup.evaluate(
    ({ statusCode, canFix }) => {
      renderStatus(statusCode, canFix);
      setFixVisibility(shouldShowFix({ code: statusCode, canFixCurrentPage: canFix }));
    },
    { statusCode: code, canFix: canFixCurrentPage }
  );
}

async function getStatus(popup) {
  return sendPopupMessage(popup, { type: "get-status" });
}

async function sendPopupMessage(popup, message) {
  return popup.evaluate((request) => new Promise((resolveStatus) => {
    chrome.runtime.sendMessage(request, (response) => {
      if (chrome.runtime.lastError) {
        resolveStatus({ ok: false, code: "runtime-error" });
        return;
      }
      resolveStatus(response || { ok: false, code: "missing-response" });
    });
  }), message);
}

async function readActivationAttempts(popup) {
  return popup.evaluate(async (key) => {
    const stored = await chrome.storage.session.get(key);
    return stored[key]?.activationAttempts || [];
  }, STATE_KEY);
}

async function readRecentResults(popup) {
  return popup.evaluate(async (key) => {
    const stored = await chrome.storage.session.get(key);
    return stored[key]?.recent || [];
  }, STATE_KEY);
}

async function containsRequiredPermission(popup) {
  return popup.evaluate(() => new Promise((resolvePermission) => {
    chrome.permissions.contains({ permissions: ["contentSettings"] }, (granted) => {
      resolvePermission(!chrome.runtime.lastError && granted === true);
    });
  }));
}

async function getEffectiveCookieSetting(context, extensionOrigin, secondaryOrigin = fixture.sfOrigin) {
  const popup = await context.newPage();
  await popup.goto(`${extensionOrigin}/src/popup.html`);
  const setting = await getEffectiveCookieSettingFromPopup(popup, secondaryOrigin);
  await popup.close();
  return setting;
}

async function getEffectiveCookieSettingFromPopup(popup, secondaryOrigin = fixture.sfOrigin) {
  return popup.evaluate(
    ({ primaryUrl, secondaryUrl }) => new Promise((resolveSetting, rejectSetting) => {
      chrome.contentSettings.cookies.get({ primaryUrl, secondaryUrl, incognito: false }, (details) => {
        const error = chrome.runtime.lastError?.message;
        if (error) {
          rejectSetting(new Error(error));
          return;
        }
        resolveSetting(details?.setting || null);
      });
    }),
    { primaryUrl: fixture.iasOrigin + "/", secondaryUrl: secondaryOrigin + "/" }
  );
}

async function readDurableAutomaticState(popup) {
  return popup.evaluate(
    async ({ ledgerKey, legacyControlKey, alarmName }) => {
      const stored = await chrome.storage.local.get([ledgerKey, legacyControlKey]);
      const alarm = await chrome.alarms.get(alarmName);
      return {
        ledger: stored[ledgerKey] || null,
        legacyControlPresent: Object.hasOwn(stored, legacyControlKey),
        alarmPresent: Boolean(alarm)
      };
    },
    { ledgerKey: RELIABLE_LEDGER_KEY, legacyControlKey: LEGACY_RELIABLE_CONTROL_KEY, alarmName: RELIABLE_ALARM_NAME }
  );
}

async function waitForFrame(source, frameUrl) {
  await waitUntil(() => source.frames().some((frame) => frame.url() === frameUrl));
  return source.frames().find((candidate) => candidate.url() === frameUrl);
}

async function waitForIasFrame(source, frameUrl) {
  const frame = await waitForFrame(source, frameUrl);
  await frame.locator("#grantAccessDiv").waitFor({ state: "attached", timeout: 5_000 });
  return frame;
}

async function captureSpaState(source) {
  return source.evaluate(() => ({
    url: window.location.href,
    historyState: window.history.state,
    shellState: window.__sapStorySmokeState,
    documentNonce: document.documentElement.dataset.documentNonce,
    navigationTimeOrigin: performance.timeOrigin
  }));
}

async function readStorageAccessState(frame) {
  return frame.evaluate(async () => {
    const permission = await navigator.permissions.query({ name: "storage-access" });
    const hasAccess = typeof document.hasStorageAccess === "function" ? await document.hasStorageAccess() : false;
    return { permission: permission.state, hasAccess };
  });
}

async function assertQuiescent(routes) {
  const before = routes.snapshot();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, QUIESCENCE_MS));
  assert.deepEqual(routes.snapshot(), before, "no delayed helper, shell reload, or duplicate IAS POST is allowed");
}

async function waitPastDetectionWindow() {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
}

async function waitPastDormantDetectionWindow() {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_800));
}

async function startFixtureServer() {
  const certificateDirectory = mkdtempSync(join(tmpdir(), "sap-story-helper-cert-v101-"));
  const keyPath = join(certificateDirectory, "fixture-key.pem");
  const certificatePath = join(certificateDirectory, "fixture-cert.pem");
  const openssl = spawnSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certificatePath, "-days", "1", "-subj", "/CN=localhost"],
    { encoding: "utf8" }
  );
  if (openssl.status !== 0) {
    rmSync(certificateDirectory, { recursive: true, force: true });
    throw new Error("OpenSSL is required to create the temporary HTTPS fixture certificate.");
  }

  const sfHost = "preview01.successfactors.eu";
  const analyticsHost = "analytics.example";
  const iasHost = "tenant.accounts.ondemand.com";
  const unapprovedHost = "unapproved.example";
  const sfOrigin = `https://${sfHost}`;
  const iasOrigin = `https://${iasHost}`;
  const unapprovedOrigin = `https://${unapprovedHost}`;
  const analyticsUrl = `https://${analyticsHost}/embedded`;
  const frameUrl = `${iasOrigin}/saml2/idp/sso/tenant`;
  const dormantFrameUrl = `${iasOrigin}/saml2/idp/sso/dormant`;
  const malformedFrameUrl = `${iasOrigin}/saml2/idp/sso/malformed`;
  const staleFrameUrl = `${iasOrigin}/saml2/idp/sso/stale`;
  const helperUrl = `${iasOrigin}/ui/storageAccess/interact`;
  const activationStoryPath = "/xi/ui/reportcenter/pages/reportCenter.xhtml";
  const counters = makeCounters();
  let sourceDocumentSequence = 0;
  let pendingReplayBarrier = null;
  let activationRecoveryArmed = false;

  const server = createServer(
    { key: readFileSync(keyPath), cert: readFileSync(certificatePath) },
    (request, response) => {
      const host = String(request.headers.host || "").split(":")[0].toLowerCase();
      const url = new URL(request.url || "/", `https://${host}`);
      response.setHeader("Content-Type", "text/html; charset=utf-8");

      if (host === sfHost && (url.pathname.startsWith("/story/") || url.pathname === activationStoryPath)) {
        counters.sourceRequests += 1;
        sourceDocumentSequence += 1;
        const childUrl = url.pathname === activationStoryPath && !activationRecoveryArmed
          ? `https://${analyticsHost}/embedded-dormant`
          : url.pathname === "/story/malformed"
          ? `https://${analyticsHost}/embedded-malformed`
          : url.pathname === "/story/stale"
            ? `https://${analyticsHost}/embedded-stale`
            : analyticsUrl;
        response.end(`<!doctype html><html data-document-nonce="source-${sourceDocumentSequence}">
          <body>
            <main id="story-shell">Story report shell</main>
            <iframe title="analytics" src="${childUrl}"></iframe>
            <script>
              const requestedHash = location.hash.startsWith("#/") ? location.hash : "#/home";
              const requestedRoute = requestedHash.startsWith("#/story/") ? "story-execute" : "home";
              history.replaceState({ route: requestedRoute, shellVersion: 1 }, "", location.pathname + requestedHash);
              window.__sapStorySmokeState = { route: requestedRoute, shellVersion: 1, unsavedUiNonce: "fixture-state-1" };
            </script>
          </body>
        </html>`);
        return;
      }

      if (host === unapprovedHost && url.pathname === "/story") {
        counters.sourceRequests += 1;
        response.end(`<!doctype html><iframe title="hidden authentication" style="display:none" src="${frameUrl}"></iframe>`);
        return;
      }

      if (host === analyticsHost && url.pathname.startsWith("/embedded")) {
        counters.analyticsRequests += 1;
        const childUrl = url.pathname === "/embedded-dormant"
          ? dormantFrameUrl
          : url.pathname === "/embedded-malformed"
          ? malformedFrameUrl
          : url.pathname === "/embedded-stale"
            ? staleFrameUrl
            : frameUrl;
        response.end(
          `<!doctype html><iframe title="hidden authentication" style="display:none;width:0;height:0;border:0" src="${childUrl}"></iframe>`
        );
        return;
      }

      if (host === iasHost && url.pathname === "/ui/storageAccess/interact") {
        counters.helperRequests += 1;
        response.end(`<!doctype html><button id="interactStorageAccess" type="button">Confirm</button>
          <script>
            document.getElementById("interactStorageAccess").addEventListener("click", () => {
              document.documentElement.dataset.nativeClick = "handled";
              navigator.sendBeacon("/sap-helper-native-beacon", "handled");
            });
          </script>`);
        return;
      }

      if (host === iasHost && url.pathname === "/sap-helper-native-beacon") {
        counters.helperNativeBeacons += 1;
        response.statusCode = 204;
        response.end();
        return;
      }

      if (host === iasHost && url.pathname === "/saml2/idp/sso/malformed") {
        counters.malformedIasRequests += 1;
        response.end(
          `<!doctype html><div id="grantAccessDiv" style="display:block">
             <button id="requestStorageAccessConfirm" type="button">Continue</button>
             <div id="storageAccessError" style="display:none">Storage access error</div>
             <form id="reloadPageForm" method="post" action="${malformedFrameUrl}">
               <input type="hidden" name="unexpected" value="never-read">
             </form>
           </div>`
        );
        return;
      }

      if (host === iasHost && url.pathname === "/saml2/idp/sso/stale") {
        counters.iasInitialRequests += 1;
        response.end(`${makeExactInterstitial(staleFrameUrl)}<script>setTimeout(() => location.replace("/gone"), 25);</script>`);
        return;
      }

      if (host === iasHost && url.pathname === "/saml2/idp/sso/dormant") {
        counters.iasInitialRequests += 1;
        response.end("<!doctype html><h1>Story access remains unavailable</h1>");
        return;
      }

      if (host === iasHost && url.pathname === "/gone") {
        counters.staleIasRequests += 1;
        response.end("<!doctype html><h1>Replaced IAS document</h1>");
        return;
      }

      if (host === iasHost && url.pathname === "/saml2/idp/sso/tenant") {
        if (request.method === "GET") {
          counters.iasInitialRequests += 1;
          response.end(makeExactInterstitial(frameUrl));
          return;
        }
        if (request.method === "POST") {
          counters.iasReplayRequests += 1;
          const barrier = pendingReplayBarrier;
          pendingReplayBarrier = null;
          barrier?.markReached();
          request.on("end", () => {
            const finish = () => response.end('<!doctype html><h1 id="ias-replay-result">IAS replay accepted</h1>');
            if (barrier) void barrier.released.then(finish);
            else finish();
          });
          // Deliberately discard the request stream. The smoke validates only
          // method/path and never reads, records, or logs any replay form value.
          request.resume();
          return;
        }
        counters.unexpectedIasMethods += 1;
        response.statusCode = 405;
        response.end("<!doctype html><h1>Method not allowed</h1>");
        return;
      }

      response.statusCode = 404;
      response.end("<!doctype html><h1>Not found</h1>");
    }
  );

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Temporary HTTPS fixture did not expose a TCP port.");
  const replacement = `127.0.0.1:${address.port}`;

  return {
    sfOrigin,
    iasOrigin,
    unapprovedOrigin,
    firstStoryUrl: `${sfOrigin}${activationStoryPath}#/story/execute/action`,
    activationHomeUrl: `${sfOrigin}${activationStoryPath}#/home?tab=myreports&view=reports`,
    activationStoryUrl: `${sfOrigin}${activationStoryPath}#/story/execute/action`,
    malformedStoryUrl: `${sfOrigin}/story/malformed`,
    staleStoryUrl: `${sfOrigin}/story/stale`,
    unapprovedStoryUrl: `${unapprovedOrigin}/story`,
    frameUrl,
    dormantFrameUrl,
    helperUrl,
    hostRules: `MAP ${sfHost} ${replacement}, MAP ${analyticsHost} ${replacement}, MAP ${iasHost} ${replacement}, MAP ${unapprovedHost} ${replacement}`,
    reset() {
      pendingReplayBarrier?.release();
      pendingReplayBarrier = null;
      activationRecoveryArmed = false;
      Object.assign(counters, makeCounters());
    },
    armActivationRecovery() {
      activationRecoveryArmed = true;
    },
    holdNextReplay() {
      if (pendingReplayBarrier) throw new Error("A replay barrier is already pending.");
      const barrier = makeReplayBarrier();
      pendingReplayBarrier = barrier;
      return { reached: barrier.reached, release: () => barrier.release() };
    },
    get sourceRequests() { return counters.sourceRequests; },
    get analyticsRequests() { return counters.analyticsRequests; },
    get iasInitialRequests() { return counters.iasInitialRequests; },
    get iasReplayRequests() { return counters.iasReplayRequests; },
    get malformedIasRequests() { return counters.malformedIasRequests; },
    get staleIasRequests() { return counters.staleIasRequests; },
    get helperRequests() { return counters.helperRequests; },
    get helperNativeBeacons() { return counters.helperNativeBeacons; },
    get unexpectedIasMethods() { return counters.unexpectedIasMethods; },
    snapshot() { return { ...counters }; },
    async close() {
      pendingReplayBarrier?.release();
      pendingReplayBarrier = null;
      await new Promise((resolveClose) => server.close(resolveClose));
      rmSync(certificateDirectory, { recursive: true, force: true });
    }
  };
}

function makeExactInterstitial(action) {
  return `<!doctype html><div id="grantAccessDiv" style="display:block">
    <p>Storage access needed</p>
    <button id="requestStorageAccessConfirm" type="button">Continue</button>
    <div id="storageAccessError" style="display:none">Storage access error</div>
    <form id="reloadPageForm" method="post" action="${action}">
      <input type="hidden" name="utf8" value="synthetic-smoke-only">
      <input type="hidden" name="authenticity_token" value="synthetic-smoke-only">
      <input type="hidden" name="method" value="POST">
      <input type="hidden" name="idpSSOEndpoint" value="synthetic-smoke-only">
      <input type="hidden" name="SAMLRequest" value="synthetic-smoke-only">
      <input type="hidden" name="RelayState" value="synthetic-smoke-only">
    </form>
  </div>`;
}

function makeCounters() {
  return {
    sourceRequests: 0,
    analyticsRequests: 0,
    iasInitialRequests: 0,
    iasReplayRequests: 0,
    malformedIasRequests: 0,
    staleIasRequests: 0,
    helperRequests: 0,
    helperNativeBeacons: 0,
    unexpectedIasMethods: 0
  };
}

function makeReplayBarrier() {
  let markReached;
  let releaseBarrier;
  let releasedOnce = false;
  const reached = new Promise((resolveReached) => { markReached = resolveReached; });
  const released = new Promise((resolveReleased) => { releaseBarrier = resolveReleased; });
  return {
    reached,
    released,
    markReached,
    release() {
      if (releasedOnce) return;
      releasedOnce = true;
      releaseBarrier();
    }
  };
}

async function waitUntil(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for loaded Edge lifecycle state.");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
}

async function waitForReplayBarrier(barrier, timeoutMs = 8_000) {
  let timeout;
  try {
    await Promise.race([
      barrier.reached,
      new Promise((_, rejectTimeout) => {
        timeout = setTimeout(() => rejectTimeout(new Error("Timed out waiting for the held IAS replay POST.")), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function assertSmokeArchitecture(extensionRoot) {
  const manifest = JSON.parse(readFileSync(join(extensionRoot, "manifest.json"), "utf8"));
  const background = readFileSync(join(extensionRoot, "src/background.js"), "utf8");
  const core = readFileSync(join(extensionRoot, "src/core.js"), "utf8");
  const content = readFileSync(join(extensionRoot, "src/ias-content.js"), "utf8");
  const activation = readFileSync(join(extensionRoot, "src/sf-activation.js"), "utf8");
  const popup = readFileSync(join(extensionRoot, "src/popup.js"), "utf8");
  const popupHtml = readFileSync(join(extensionRoot, "src/popup.html"), "utf8");
  const popupCss = readFileSync(join(extensionRoot, "src/popup.css"), "utf8");

  assert.equal(manifest.version, "1.1.0");
  assert.deepEqual(manifest.permissions, ["storage", "alarms", "contentSettings"]);
  assert.equal(manifest.optional_permissions, undefined);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.deepEqual(manifest.host_permissions, [
    "https://*.successfactors.com/*",
    "https://*.successfactors.eu/*",
    "https://*.successfactors.cn/*",
    "https://*.sapsf.com/*",
    "https://*.sapsf.eu/*",
    "https://*.sapsf.cn/*",
    "https://*.hr.cloud.sap/*",
    "https://*.sapcloud.cn/*"
  ]);
  assert.equal(manifest.incognito, "not_allowed");
  assert.equal(manifest.content_scripts?.[0]?.all_frames, true);
  assert.equal(manifest.content_scripts?.length, 2);
  assert.deepEqual(manifest.content_scripts?.[1]?.js, ["src/sf-activation.js"]);
  assert.equal(manifest.content_scripts?.[1]?.all_frames, false);
  assert.equal(manifest.content_scripts?.[1]?.run_at, "document_start");

  assert.match(core, /sapIasStorageAccessWorkflows\.v9/);
  assert.doesNotMatch(background, /pause-automatic-fixing/);
  assert.doesNotMatch(background, /resume-automatic-fixing/);
  assert.match(background, /const LEGACY_RELIABLE_CONTROL_KEY = "sapIasReliableModeControl\.v1";/);
  assert.match(background, /await removeLegacyPauseMarker\(\)/);
  assert.match(background, /chrome\.storage\.local\.remove\(LEGACY_RELIABLE_CONTROL_KEY\)/);
  assert.match(background, /await cookies\.set\s*\(/, "runtime must set a bounded cookie content rule");
  assert.match(background, /chrome\.contentSettings\.cookies\.get/, "runtime must verify the exact effective rule");
  assert.match(background, /replay-schedule-committed/, "runtime must retain the durable replay barrier");
  assert.match(background, /chrome\.tabs\.onUpdated\.addListener/, "same-tab Report Center transitions must be observed");
  assert.match(background, /startupActivationScanDecisionPromise/, "worker startup must retain its safe scan decision");
  assert.match(background, /shouldScan \? evaluateActiveReportCenterTabs\(\) : undefined/, "same-build worker startup must inspect the active page");
  assert.match(background, /isSupportedReportCenterUrl\(tab\.url\)/, "recovery must remain on the exact Report Center path");
  assert.match(background, /message\.type === "force-fix-current-tab" && hasExactKeys\(message, \["type"\]\)/);
  assert.match(background, /message\.type === "force-fix-current-tab"[\s\S]{0,240}isTrustedPopupSender\(sender\)/);
  assert.match(background, /const MANUAL_FIX_COOLDOWN_MS = 30_000/);
  assert.match(background, /const MANUAL_RELOAD_DELAY_MS = 1_200/);
  assert.match(background, /canFixCurrentPage/);
  assert.match(background, /currentPageState/);
  assert.match(background, /scheduleClaimedReportCenterReload\(currentTab\.id, currentTab\.windowId\)/);
  assert.match(background, /async function performClaimedReportCenterReload/);
  assert.match(background, /assessActiveAllowanceForTab/);
  assert.match(background, /effective\?\.setting === "allow"/);
  assert.doesNotMatch(background, /\bchrome\s*\.\s*tabs\s*\.\s*create\s*\(/, "recovery must not create helper or replacement tabs");
  assert.equal(
    (background.match(/\bchrome\s*\.\s*tabs\s*\.\s*reload\s*\(/g) || []).length,
    2,
    "automatic and manual recovery may contain only their two reviewed ordinary-reload sites"
  );
  assert.ok(
    background.indexOf("state.activationAttempts.push(attempt)") < background.search(/\bchrome\s*\.\s*tabs\s*\.\s*reload\s*\(/),
    "the durable once-only recovery tombstone must be persisted before tabs.reload"
  );
  assert.ok(
    background.indexOf("state.activationAttempts = [...remainingAttempts, attempt]") <
      background.indexOf("scheduleClaimedReportCenterReload(currentTab.id, currentTab.windowId)"),
    "the manual recovery tombstone must be persisted before its delayed reload is scheduled"
  );
  assert.match(content, /if \(window\.top === window\) return;/, "top-level SAP helper pages must remain untouched");
  assert.match(content, /resume-with-cookie-exception/);
  assert.match(content, /HTMLFormElement\s*\.\s*prototype\s*\.\s*submit\s*\.\s*call\s*\(/);
  assert.match(content, /replayGate\.then\(\(\) => submitReplayPlan\(result\)\)/);
  assert.doesNotMatch(content, /\bnew\s+FormData\s*\(/, "extension must not serialize POST fields");
  assert.doesNotMatch(content, /\bcontrol\s*\.\s*value\b/, "extension must not read POST field values");
  assert.match(activation, /const BUILD = "1\.1\.0";/);
  assert.match(activation, /const PROTOCOL = 1;/);
  assert.match(activation, /message\.type !== "sf-activation-probe"/);
  assert.match(activation, /type: "sf-activation-current"/);
  assert.match(activation, /type: "sf-activation-ready"/);
  assert.doesNotMatch(activation, /\b(?:document|location|history)\b/, "the top-level activation sentinel must not inspect SAP page content");
  assert.doesNotMatch(popup, /chrome\.permissions\.(?:request|remove)/, "required permission must have no popup permission gate");
  assert.doesNotMatch(popup, /(?:open-fresh-report-center|helper-ready|recoveryOfferId)/);
  assert.doesNotMatch(popup, /(?:pause-automatic-fixing|resume-automatic-fixing)/);
  assert.match(popupHtml, /id="status-title">Checking this page…/);
  assert.match(popupHtml, /id="fix-action" hidden/);
  assert.match(popupCss, /\.status-dot\.checking\s*\{[^}]*animation:/s);
  assert.match(popupCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/s);
  assert.match(popup, /sendRuntimeMessage\(\{ type: "force-fix-current-tab" \}\)/);
  assert.match(popup, /const SAP_KB_URL = "https:\/\/userapps\.support\.sap\.com\/sap\/support\/knowledge\/en\/3039244";/);
  assert.match(popup, /chrome\.tabs\.create\(\{ url: SAP_KB_URL \}\)/);
  assert.equal((popup.match(/chrome\.tabs\.create\s*\(/g) || []).length, 1);
  assert.equal((popupHtml.match(/<button\b/g) || []).length, 2);
  assert.match(popupHtml, /id="fix-report"/);
  assert.match(popupHtml, /Fix this report/);
  assert.match(popupHtml, /id="sap-help"/);
  assert.match(popupHtml, /Open SAP help article/);
  assert.match(popup, /sendRuntimeMessage\(\{ type: "force-fix-current-tab" \}\)/);
  assert.match(popup, /fixed: \["Fix applied"/);
  assert.match(popup, /idle: \["No fix applied yet"/);
  assert.match(popup, /if \(code === "replay-scheduled" \|\| code === "fix-already-applied"\) return "fixed"/);
  assert.doesNotMatch(popupHtml, /\b(?:IAS|contentSettings|cookie|origin|replay|durable)\b/i);
  assert.doesNotMatch(popupHtml, /\b(?:pause|resume)\b/i);
}

function prepareExtensionRoot() {
  const zip = String(process.env.SMOKE_EXTENSION_ZIP || "").trim();
  if (!zip) return { root: projectRoot, archive: null, fromZip: false, cleanup: () => undefined };
  const archive = resolve(zip);
  if (!existsSync(archive)) throw new Error(`Store ZIP not found: ${archive}`);
  const extracted = mkdtempSync(join(tmpdir(), "sap-story-helper-package-v101-"));
  const attempts = archiveExtractionAttempts(archive, extracted);
  let lastError = "no compatible archive extractor was found";
  for (const attempt of attempts) {
    const result = spawnSync(attempt.command, attempt.args, { encoding: "utf8" });
    if (result.status === 0 && existsSync(join(extracted, "manifest.json"))) {
      return {
        root: extracted,
        archive,
        fromZip: true,
        cleanup: () => rmSync(extracted, { recursive: true, force: true })
      };
    }
    lastError = result.error?.message || result.stderr?.trim() || `${attempt.command} exited ${result.status}`;
  }
  rmSync(extracted, { recursive: true, force: true });
  throw new Error(`Could not extract a valid extension package: ${lastError}`);
}

function archiveExtractionAttempts(archive, destination) {
  if (process.platform === "win32") {
    return [
      { command: "tar.exe", args: ["-xf", archive, "-C", destination] },
      {
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "& { param([string]$Archive,[string]$Destination) Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force }",
          archive,
          destination
        ]
      }
    ];
  }
  if (process.platform === "darwin") {
    return [
      { command: "/usr/bin/ditto", args: ["-x", "-k", archive, destination] },
      { command: "unzip", args: ["-q", archive, "-d", destination] }
    ];
  }
  return [
    { command: "unzip", args: ["-q", archive, "-d", destination] },
    { command: "tar", args: ["-xf", archive, "-C", destination] }
  ];
}

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const explicitRoot = String(process.env.PLAYWRIGHT_MODULE_PATH || "").trim();
  if (explicitRoot) return require(resolve(explicitRoot, "playwright"));
  try {
    return require("playwright");
  } catch {
    throw new Error("Playwright was not found. Set PLAYWRIGHT_MODULE_PATH to a node_modules directory containing playwright.");
  }
}

function findEdgeExecutable() {
  const windowsRoots = [
    process.env["PROGRAMFILES(X86)"],
    process.env.PROGRAMFILES,
    process.env.ProgramW6432,
    process.env.LOCALAPPDATA
  ].filter(Boolean);
  const candidates = [
    String(process.env.EDGE_EXECUTABLE || "").trim(),
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Microsoft Edge Beta.app/Contents/MacOS/Microsoft Edge Beta",
    "/Applications/Microsoft Edge Dev.app/Contents/MacOS/Microsoft Edge Dev",
    ...windowsRoots.flatMap((root) => [
      join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(root, "Microsoft", "Edge Beta", "Application", "msedge.exe"),
      join(root, "Microsoft", "Edge Dev", "Application", "msedge.exe")
    ]),
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/microsoft-edge-beta",
    "/usr/bin/microsoft-edge-dev"
  ].filter(Boolean);
  const executable = candidates.find(existsSync);
  if (!executable) throw new Error("Microsoft Edge was not found. Set EDGE_EXECUTABLE to the verified browser executable.");
  return executable;
}

function formatRuntimeErrors(errors) {
  return `loaded extension emitted runtime errors: ${errors.join(" | ")}`;
}
