import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = new URL("../", import.meta.url);
const manifest = readJson("manifest.json");
const packageJson = readJson("package.json");

assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(manifest.version === packageJson.version, "manifest and package versions must match");
assert(manifest.version === "1.1.1", "the verified source must be v1.1.1");
assert(manifest.version_name === "1.1.1", "the verified release label must be v1.1.1");
assert(manifest.incognito === "not_allowed", "incognito must be explicitly disabled");
assert(
  JSON.stringify(manifest.permissions) === JSON.stringify(["storage", "alarms", "contentSettings"]),
  "storage, alarms, and contentSettings must be the only required API permissions"
);
assert(!manifest.optional_permissions, "optional permissions must not be declared");
const expectedSfHostPermissions = [
  "https://*.successfactors.com/*",
  "https://*.successfactors.eu/*",
  "https://*.successfactors.cn/*",
  "https://*.sapsf.com/*",
  "https://*.sapsf.eu/*",
  "https://*.sapsf.cn/*",
  "https://*.hr.cloud.sap/*",
  "https://*.sapcloud.cn/*"
];
assert(
  JSON.stringify(manifest.host_permissions) === JSON.stringify(expectedSfHostPermissions),
  "host access must be limited to reviewed standard SuccessFactors families"
);
assert(manifest.background?.type === "module", "the service worker must be an ES module");
assert(manifest.content_scripts?.length === 2, "exactly two declarative content-script rules are expected");

const contentRule = manifest.content_scripts[0];
const expectedIasMatches = [
  "https://*.accounts.ondemand.com/*",
  "https://*.accounts400.ondemand.com/*",
  "https://*.accounts.cloud.sap/*",
  "https://*.accounts400.cloud.sap/*",
  "https://*.accounts.sapcloud.cn/*"
];
assert(
  JSON.stringify(contentRule.matches) === JSON.stringify(expectedIasMatches),
  "only the reviewed standard IAS host families may be in content-script scope"
);
assert(contentRule.all_frames === true, "IAS interstitial detection must include nested frames");
assert(contentRule.match_about_blank === false, "about: frame inheritance must remain disabled");
assert(contentRule.match_origin_as_fallback === false, "origin fallback injection must remain disabled");

const sfActivationRule = manifest.content_scripts[1];
const expectedSfReportCenterMatches = expectedSfHostPermissions.map((pattern) =>
  `${pattern.slice(0, -1)}xi/ui/reportcenter/pages/reportCenter.xhtml*`
);
assert(
  JSON.stringify(sfActivationRule.matches) === JSON.stringify(expectedSfReportCenterMatches),
  "the activation marker must be limited to the exact Report Center path"
);
assert(JSON.stringify(sfActivationRule.js) === JSON.stringify(["src/sf-activation.js"]), "unexpected activation content script");
assert(sfActivationRule.all_frames === false, "the activation marker must be top-frame only");
assert(sfActivationRule.run_at === "document_start", "the activation marker must register at document_start");
assert(sfActivationRule.match_about_blank === false, "activation about: inheritance must remain disabled");
assert(sfActivationRule.match_origin_as_fallback === false, "activation origin fallback must remain disabled");

const packageFiles = [
  "manifest.json",
  "src/background.js",
  "src/core.js",
  "src/ias-content.js",
  "src/sf-activation.js",
  "src/popup.html",
  "src/popup.css",
  "src/popup.js",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png"
];
for (const file of packageFiles) assert(existsSync(new URL(file, projectRoot)), `Missing packaged file: ${file}`);

const sourceFiles = ["src/background.js", "src/core.js", "src/ias-content.js", "src/sf-activation.js", "src/popup.js"];
const forbidden = [
  [/chrome\.cookies\b/, "cookie API"],
  [/chrome\.webRequest\b/, "webRequest API"],
  [/chrome\.scripting\b/, "scripting API"],
  [/chrome\.tabs\.remove\s*\(/, "tab removal"],
  [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/, "extension-initiated network request"],
  [/\bnavigator\.sendBeacon\s*\(/, "beacon telemetry"],
  [/\.dispatchEvent\s*\(/, "synthetic DOM event dispatch"],
  [/\.click\s*\(/, "programmatic DOM click"],
  [/\beval\s*\(/, "eval"],
  [/\bnew\s+Function\b/, "dynamic Function construction"],
  [/--(?:disable-web-security|ignore-certificate-errors|disable-features)/, "unsafe browser flag"]
];
for (const file of sourceFiles) {
  const source = readFileSync(new URL(file, projectRoot), "utf8");
  for (const [pattern, label] of forbidden) assert(!pattern.test(source), `${file} contains forbidden ${label}`);
  const check = spawnSync(process.execPath, ["--check", fileURLToPath(new URL(file, projectRoot))], { encoding: "utf8" });
  assert(check.status === 0, `${file} failed syntax check: ${check.stderr.trim()}`);
}

const background = readFileSync(new URL("src/background.js", projectRoot), "utf8");
const core = readFileSync(new URL("src/core.js", projectRoot), "utf8");
const iasContent = readFileSync(new URL("src/ias-content.js", projectRoot), "utf8");
const sfActivation = readFileSync(new URL("src/sf-activation.js", projectRoot), "utf8");
const popup = readFileSync(new URL("src/popup.js", projectRoot), "utf8");
const popupHtml = readFileSync(new URL("src/popup.html", projectRoot), "utf8");
const popupCss = readFileSync(new URL("src/popup.css", projectRoot), "utf8");
const edgeSmoke = readFileSync(new URL("scripts/smoke-edge.mjs", projectRoot), "utf8");
const runtime = `${background}\n${core}\n${iasContent}\n${sfActivation}\n${popup}`;

for (const legacy of [
  "helper-ready",
  "helper-confirmed",
  "helper-open",
  "resume-source-document",
  "open-fresh-report-center",
  "fresh-report-center",
  "recoveryOfferId",
  "makeRecoveryOffer",
  "makeReportCenterUrl",
  "makeHelperUrl",
  "isExactHelperUrl"
]) {
  assert(!runtime.includes(legacy), `direct-only runtime still contains legacy ${legacy}`);
}

assert(
  /(?:chrome\.contentSettings(?:\?\.)?\.cookies|\bcookies)\.set\s*\(/.test(background),
  "automatic mode must set exact cookie content-setting pairs"
);
assert(
  /(?:chrome\.contentSettings(?:\?\.)?\.cookies|\bcookies)\.get\s*\(/.test(background),
  "automatic mode must verify the effective cookie setting"
);
assert(
  /(?:chrome\.contentSettings(?:\?\.)?\.cookies|\bcookies)\.clear\s*\(/.test(background),
  "automatic mode must support clearing its cookie rules"
);
assert(
  background.includes('scope: "regular"') || background.includes("scope: 'regular'"),
  "content-setting writes and cleanup must be limited to regular scope"
);
assert(
  background.includes('accessLevel: "TRUSTED_CONTEXTS"') || background.includes("accessLevel: 'TRUSTED_CONTEXTS'"),
  "the durable allowance ledger and legacy-marker cleanup must be restricted to trusted extension contexts"
);
assert(!/chrome\.contentSettings\b/.test(core), "core helpers must not call contentSettings directly");
assert(!/chrome\.contentSettings\b/.test(iasContent), "IAS content scripts must not call contentSettings");
assert(!/chrome\.contentSettings\b/.test(popup), "the popup must delegate content-setting mutations to the service worker");
assert(core.includes("primaryPattern: `https://${iasUrl.hostname}:443/*`"), "IAS primary patterns must be exact HTTPS port 443 hosts");
assert(core.includes("secondaryPattern: `https://${sourceUrl.hostname}:443/*`"), "SuccessFactors secondary patterns must be exact HTTPS port 443 hosts");
assert(!/[`'"]https:\/\/\*\.(?:accounts|successfactors|sapsf|sapcloud|cloud\.sap)/.test(core), "cookie exceptions must never use wildcard parent domains");
assert(!core.includes("<all_urls>"), "cookie exceptions must never use all-URL scope");

assert(background.includes('const SF_ACTIVATION_BUILD = "1.1.1"'), "background activation build must be current");
assert(sfActivation.includes('const BUILD = "1.1.1"'), "top-frame activation build must be current");
assert(sfActivation.includes('const PROTOCOL = 1'), "top-frame activation protocol must be explicit");
assert(!/\b(?:document|fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage)\b/.test(sfActivation), "activation marker must not inspect page data or use storage/network APIs");
assert(background.includes("chrome.runtime.onInstalled.addListener"), "install recovery listener is required");
assert(background.includes("chrome.tabs.onActivated.addListener"), "re-enable activation recovery listener is required");
assert(background.includes("chrome.tabs.onUpdated.addListener"), "same-tab Report Center navigation recovery listener is required");
assert(
  background.includes("startupActivationScanDecisionPromise") &&
    background.includes("shouldScan ? evaluateActiveReportCenterTabs() : undefined"),
  "worker initialization must inspect the active Report Center page"
);
assert(background.includes("lastFocusedWindow: true"), "install recovery must target only the focused window");
assert(background.includes("url: SF_ACTIVE_REPORT_CENTER_QUERY_PATTERNS"), "active scans must remain limited to Report Center URLs");
assert(background.includes("isSupportedReportCenterUrl(tab.url)"), "recovery must validate the exact Report Center path");
assert(core.includes("export function isSupportedReportCenterUrl"), "core must validate supported Report Center routes centrally");
assert(background.includes("chrome.windows.get(windowId)"), "recovery must verify actual window focus");
assert(
  background.includes('chrome.windows.getLastFocused({ windowTypes: ["normal"] })'),
  "toolbar-popup status and manual recovery must preserve the last-focused normal Edge window"
);
assert(background.includes("state.activationAttempts.push(attempt)"), "recovery must persist a write-ahead tombstone");
const safeTabStart = background.indexOf("function isSafeReportCenterTab");
const safeTabEnd = background.indexOf("async function isFocusedNormalWindow", safeTabStart);
const safeTabSource = background.slice(safeTabStart, safeTabEnd);
assert(safeTabStart >= 0 && safeTabEnd > safeTabStart, "recovery must centralize safe Report Center tab validation");
assert(
  safeTabSource.includes('["loading", "complete"].includes(tab.status)'),
  "safe Report Center recovery must accept both loading and complete top-level documents"
);
assert(background.includes("chrome.tabs.reload(tabId, { bypassCache: false })"), "recovery must use one normal reload");
assert((background.match(/chrome\.tabs\.reload\s*\(/g) || []).length === 2, "automatic and manual recovery must be the only tab reload call sites");
assert(
  (background.match(/chrome\.tabs\.reload\([^\n]+\{ bypassCache: false \}\)/g) || []).length === 2,
  "every recovery reload must preserve the browser cache"
);
assert(!/chrome\.tabs\.(?:create|remove)\s*\(/.test(background), "recovery must never create or remove tabs");
assert(!manifest.permissions.includes("tabs"), "the broad tabs permission is forbidden");
assert(!manifest.permissions.includes("scripting"), "the scripting permission is forbidden");
assert(!manifest.permissions.includes("management"), "the management permission is forbidden");
assert(!manifest.permissions.includes("webNavigation"), "the webNavigation permission is forbidden");
assert(!manifest.host_permissions.includes("<all_urls>"), "all-URL host access is forbidden");

assert(background.includes('message.type === "force-fix-current-tab"'), "the bounded manual fix message is required");
assert(background.includes("return handleForceFixCurrentTab()"), "the trusted popup must delegate manual recovery to the service worker");
assert(background.includes("const MANUAL_FIX_COOLDOWN_MS = 30_000"), "manual repeat protection must retain its 30-second cooldown");
assert(background.includes("const MANUAL_RELOAD_DELAY_MS = 1_200"), "manual recovery must retain a short bounded UI acknowledgement delay");
assert(
  /message\.type === "force-fix-current-tab" && hasExactKeys\(message, \["type"\]\)/.test(background),
  "manual fix requests must accept only the exact one-field message"
);
assert(
  /message\.type === "force-fix-current-tab"[\s\S]{0,240}isTrustedPopupSender\(sender\)/.test(background),
  "manual fix requests must be restricted to the trusted popup"
);
assert(
  background.includes("state.recent = state.recent.filter((entry) => entry.sourceTabId !== currentTab.id)"),
  "manual recovery may clear only stale terminal records for the active tab"
);
assert(
  /const remainingAttempts = state\.activationAttempts\.filter\([\s\S]{0,120}attempt\.tabId !== currentTab\.id/.test(background) &&
    background.includes("state.activationAttempts = [...remainingAttempts, attempt]"),
  "manual recovery may clear only stale activation records for the active tab"
);
assert(
  background.includes("scheduleClaimedReportCenterReload(currentTab.id, currentTab.windowId, currentTab.url)"),
  "manual reload must bind the delayed claimed-tab path to the exact accepted URL"
);
assert(background.includes("async function performClaimedReportCenterReload"), "the delayed reload must revalidate its durable claim");
assert(background.includes("tab.url !== expectedUrl"), "the delayed reload must reject same-tab navigation before its side effect");
assert(background.includes("assessActiveAllowanceForTab"), "fixed status must assess the exact current browser rule");
assert(background.includes('effective?.setting === "allow"'), "fixed status must require an effective allow rule");
assert(background.includes('return "check-unavailable"'), "an unverifiable browser rule must fail closed in public status");
const contextualStatusStart = background.indexOf("function contextualStatusCode");
const contextualStatusEnd = background.indexOf("function canForceFixCurrentPage", contextualStatusStart);
const contextualStatusSource = background.slice(contextualStatusStart, contextualStatusEnd);
const replayEvidencePosition = contextualStatusSource.indexOf('recent?.outcome === "replay-scheduled"');
const allowanceEvidencePosition = contextualStatusSource.indexOf("allowance.active");
const loadingFallbackPosition = contextualStatusSource.indexOf('context.pageState === "loading"');
assert(
  contextualStatusStart >= 0 &&
    contextualStatusEnd > contextualStatusStart &&
    replayEvidencePosition >= 0 &&
    allowanceEvidencePosition > replayEvidencePosition &&
    loadingFallbackPosition > allowanceEvidencePosition,
  "verified replay and effective allowance evidence must outrank transient tab loading"
);

assert(core.includes("export const RELIABLE_RULE_TTL_MS = 60 * 60 * 1000"), "allowance lifetime must have a hard 60-minute ceiling");
assert(core.includes("export const MAX_RELIABLE_PAIRS = 20"), "the local allowance ledger must be capped at 20 pairs");
assert(core.includes("expiresAt: now + RELIABLE_RULE_TTL_MS"), "new allowance expiry must derive from creation time");
assert(core.includes(".slice(0, MAX_RELIABLE_PAIRS)"), "pruned allowance ledgers must enforce the pair cap");
assert(
  core.includes("expiresAt - createdAt > RELIABLE_RULE_TTL_MS"),
  "persisted allowances exceeding the hard lifetime must be rejected"
);

assert(!runtime.includes("pause-automatic-fixing"), "the v1 runtime must not retain the removed Pause control contract");
assert(!runtime.includes("resume-automatic-fixing"), "the v1 runtime must not retain the removed Resume control contract");
assert(
  !`${core}\n${iasContent}\n${sfActivation}\n${popup}`.includes("sapIasReliableModeControl.v1"),
  "only service-worker startup migration code may reference the legacy Pause marker"
);
assert(
  background.includes('const LEGACY_RELIABLE_CONTROL_KEY = "sapIasReliableModeControl.v1"'),
  "startup must identify the legacy Pause marker exactly"
);
assert(background.includes("await removeLegacyPauseMarker()"), "startup must delete the legacy Pause marker");
assert(
  background.includes("await chrome.storage.local.remove(LEGACY_RELIABLE_CONTROL_KEY)"),
  "legacy Pause-marker cleanup must remove only the exact historical key"
);
assert(background.includes('hasExactKeys(message, ["type"])'), "the popup status request must accept only an exact message shape");
assert(background.includes("isTrustedPopupSender(sender)"), "popup status access must be restricted to the trusted popup");
assert(background.includes("canFixCurrentPage"), "public status must state whether the current page can be fixed");
assert(background.includes("currentPageState"), "public status must expose only a sanitized current-page state");

assert(core.includes('export const STATE_KEY = "sapIasStorageAccessWorkflows.v9"'), "session state must use the v9 phased recovery schema");
assert(core.includes("export const STATE_VERSION = 9"), "session state version must be 9");
assert(
  core.includes('["reload-scheduled", "reload-pending", "reload-attempted"]'),
  "recovery markers must have exact scheduled, pending, and terminal phases"
);
assert(sfActivation.includes('type: "sf-activation-ready"'), "a newly loaded top document must announce the current activation marker");
assert(background.includes("handleStoryActivationReady(message, sender)"), "the background must authenticate the post-reload marker transition");
assert(
  background.includes('hasExactKeys(message, ["resumeAttemptId", "type"])'),
  "durable replay commits must accept only an exact attempt-token message"
);
assert(background.includes("handleReplayScheduleReady(message, sender)"), "the background must own the durable replay commit");
assert(background.includes('appendRecentResult(state, workflow, "replay-scheduled")'), "the commit must persist a scheduled tombstone");
assert(background.includes("isMatchingReplaySchedule"), "outer channel loss must reconcile against the exact scheduled attempt");
assert(background.includes("function requestExactDocumentResume(workflow)"), "continuation must use the bounded exact-document transport");
assert(background.includes("documentId: workflow.sourceDocumentId"), "continuation must target the exact originating IAS document");
assert(background.includes("const DIRECT_RESUME_TIMEOUT_MS = 5_000"), "a stalled exact-document continuation must release startup recovery");
assert(background.includes("const initializationPromise = initializeBackground()"), "cold-worker messages must have one startup barrier");
const messageDispatchStart = background.indexOf("chrome.runtime.onMessage.addListener");
const messageDispatchEnd = background.indexOf("chrome.tabs.onRemoved.addListener", messageDispatchStart);
const messageDispatchSource = background.slice(messageDispatchStart, messageDispatchEnd);
assert(
  /message\?\.type === "get-status"[\s\S]{0,240}\? Promise\.resolve\(\)\.then\(\(\) => dispatchMessage\(message, sender\)\)/.test(
    messageDispatchSource
  ),
  "trusted popup status must use a non-blocking cold-worker fast lane"
);
assert(
  !/message\?\.type === "get-status"[\s\S]{0,240}\? startupRecoveryPromise/.test(messageDispatchSource),
  "popup status must never wait behind startup recovery"
);
assert(background.includes("const POPUP_STATUS_TIMEOUT_MS = 750"), "background status snapshots must have a short deadline");
assert(
  /Promise\.race\(\[[\s\S]{0,200}getSingleFlightPublicStatusSnapshot\(\)[\s\S]{0,240}makeUnavailablePublicStatus\(\)/.test(background),
  "slow browser APIs must degrade to a sanitized popup status instead of blocking the UI"
);
assert(background.includes("let publicStatusSnapshotPromise = null"), "live popup polling must share one in-flight browser status snapshot");
assert(background.includes("const POPUP_STATUS_SNAPSHOT_STALE_MS = 2_000"), "a stalled popup snapshot must become replaceable");
assert(background.includes("const MAX_PUBLIC_STATUS_SNAPSHOTS = 2"), "stalled popup browser calls must remain strictly capped");
assert(
  background.includes("publicStatusSnapshotsInFlight.size >= MAX_PUBLIC_STATUS_SNAPSHOTS"),
  "popup status recovery must not accumulate uncancellable browser API calls"
);
assert(
  /initializationPromise\s*\.then\(\(\) => dispatchMessage\(message, sender\)\)/s.test(background),
  "new detections must wait for startup reconciliation before claiming a workflow"
);
assert(core.includes('"replay-scheduled"'), "replay-scheduled must remain a sanitized public result code");
const legacyReplayCode = ["replay", "submitted"].join("-");
assert(!runtime.includes(legacyReplayCode), "runtime and popup source must not claim replay submission");

assert(iasContent.includes("if (window.top === window) return;"), "top-level IAS pages must remain untouched");
assert(iasContent.includes('message?.type === "resume-with-cookie-exception"'), "only exact-pair continuation may request replay");
assert(iasContent.includes("new MutationObserver(scheduleInterstitialChecks)"), "slow IAS insertion must remain mutation-driven");
assert(!iasContent.includes("OBSERVER_TIMEOUT_MS"), "IAS detection must not stop after a fixed observer timeout");
assert(!iasContent.includes("10_000"), "IAS detection must not retain the historical 10-second cutoff");
assert(iasContent.includes("observer.disconnect()"), "IAS observation must stop after the exact interstitial is reported");
assert(!iasContent.includes("document.requestStorageAccess("), "automatic mode must not invoke an interactive Storage Access prompt");
assert(iasContent.includes("if (resumeAttempted)"), "a document-local guard must prevent repeat continuation");
assert((iasContent.match(/HTMLFormElement\.prototype\.submit\.call\(/g) || []).length === 1, "exactly one reviewed native form-submit call site is allowed");
assert(iasContent.includes("Array.from(replayForm.elements)"), "all form-associated replay controls must be validated");
assert(!/\.value\b/.test(iasContent), "IAS replay field values must never be read");
assert(!/\b(?:FormData|cookieStore)\b/.test(iasContent), "IAS continuation must not expose form values or cookie data through alternate APIs");
assert(!/\bdocument\.cookie\b/.test(runtime), "extension source must never read browser cookies");
assert(!/requestSubmit\s*\(/.test(iasContent), "IAS replay must not synthesize a submit-button activation");

const deliveryStart = iasContent.indexOf("async function deliverResumeResult");
const gatedTask = iasContent.indexOf("replayGate.then(() => submitReplayPlan(result))", deliveryStart);
const commitRequest = iasContent.indexOf('type: "replay-schedule-ready"', deliveryStart);
const commitCheck = iasContent.indexOf("isExactReplayCommit(commit, resumeAttemptId)", commitRequest);
const outerAcknowledgement = iasContent.indexOf("sendResponse(result.response)", commitCheck);
const releaseReplay = iasContent.indexOf("releaseReplay()", outerAcknowledgement);
const nativeReplay = iasContent.indexOf("HTMLFormElement.prototype.submit.call(interstitial.replayForm)");
assert(deliveryStart >= 0, "the IAS content script must implement the durable delivery barrier");
assert(gatedTask > deliveryStart, "one replay task must be registered behind a closed gate");
assert(commitRequest > gatedTask, "the gated task must exist before the durable commit request");
assert(commitCheck > commitRequest, "the exact commit acknowledgement must be checked");
assert(outerAcknowledgement > commitCheck, "the original response may be acknowledged only after durable commit");
assert(releaseReplay > outerAcknowledgement, "native replay may be released only after the outer response is answered");
assert(nativeReplay > releaseReplay, "native replay must remain downstream of the durable commit gate");

assert(!/<(?:input|select|textarea)\b/i.test(popupHtml), "the popup must not collect tenant or account input");
assert(!/\b(?:IAS|contentSettings|cookie|origin|replay|durable|reliable mode|recovery)\b/i.test(popupHtml), "the popup must not expose technical setup terminology");
assert(!/chrome\.permissions\.(?:request|remove)\s*\(/.test(popup), "required automatic mode must not expose a runtime permission setup flow");
assert(!/\b(?:pause|resume)\b/i.test(popupHtml), "the popup must not expose removed Pause or Resume controls");
assert((popupHtml.match(/<button\b/g) || []).length === 2, "the popup must contain only the manual fix and SAP help actions");
assert(popupHtml.includes('id="status-title">Checking this report…'), "the popup must begin with a visible checking state");
assert(
  popupHtml.includes('id="status-detail">This status updates automatically.'),
  "the static popup must explain that status updates in place before JavaScript runs"
);
assert(popupHtml.includes('id="status-card"') && popupHtml.includes('aria-busy="true"'), "the initial status must be marked busy");
assert(popupHtml.includes('id="fix-action" hidden'), "the manual action must start hidden until the page check completes");
assert(/\.status-dot\.checking\s*\{[^}]*animation:/s.test(popupCss), "the checking state must have a visible animation");
assert(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/s.test(popupCss), "the checking animation must respect reduced-motion preferences");
assert(popupHtml.includes('id="fix-report"'), "the popup must expose one clearly identified manual fix action");
assert(popupHtml.includes("Fix this report"), "the manual fix action must use plain end-user wording");
assert(popupHtml.includes('id="sap-help"'), "the popup must expose one clearly identified SAP help action");
assert(popupHtml.includes("Open SAP help article"), "the SAP help action must use plain end-user wording");
assert(popupHtml.includes("No report data sent"), "the popup must state its local data boundary in plain language");
assert(popup.includes('fixed: ["Access fix applied"'), "the popup must distinguish a completed access fix from readiness");
assert(popup.includes('idle: ["Extension ready"'), "the popup must present a calm ready state when no action is needed");
assert(
  popup.includes('if (code === "replay-scheduled" || code === "fix-already-applied") return "fixed"'),
  "only a durable replay or verified active fix may be presented as Fix applied"
);
assert(
  popup.includes('sendRuntimeMessage({ type: "force-fix-current-tab" })'),
  "the manual action must delegate one exact force-fix request to the service worker"
);
assert(popup.includes("status.canFixCurrentPage"), "the popup must gate the manual action on the current-page capability");
assert(popup.includes('return state === "unavailable"'), "the manual fallback must remain available when status checking is unavailable");
assert(popup.includes("setFixVisibility(shouldShowFix(status))"), "known runtime states must explicitly show or hide the manual action");
assert(popup.includes("const STATUS_REQUEST_TIMEOUT_MS = 1_000"), "each popup status request must have a short deadline");
assert(popup.includes("const STATUS_POLL_INTERVAL_MS = 500"), "an open popup must refresh its status automatically");
assert(popup.includes("const STATUS_RETRY_INTERVAL_MS = 250"), "temporary status failures must retry promptly");
assert(popup.includes("async function pollPopupStatus"), "the popup must own a live self-refresh loop");
assert(popup.includes("statusPollInFlight"), "the popup must prevent overlapping status requests");
assert(popup.includes("renderGeneration"), "late popup responses must not overwrite a newer result");
assert(!/setInterval\s*\(/.test(popup), "popup refresh must use bounded chained timers rather than a permanent interval");
assert(!/reopen this window/i.test(popup), "the popup must never ask the user to close and reopen it for fresh status");
assert(!/\bpopup\.reload\s*\(/.test(edgeSmoke), "Edge smoke must prove live popup transitions without reloading the popup");
assert(
  popup.includes('const SAP_KB_URL = "https://userapps.support.sap.com/sap/support/knowledge/en/3039244"'),
  "the popup must pin the exact public SAP KBA 3039244 URL"
);
assert(
  popup.includes("chrome.tabs.create({ url: SAP_KB_URL })"),
  "the SAP help action must open only the pinned KBA URL"
);
assert((popup.match(/chrome\.tabs\.create\s*\(/g) || []).length === 1, "the KBA action must be the only tab-creation site");
assert((runtime.match(/chrome\.tabs\.create\s*\(/g) || []).length === 1, "no runtime component other than the KBA action may create a tab");

console.log("Manifest, automatic exact-pair, durable replay, legacy cleanup, simple popup, and source-safety checks passed.");

function readJson(path) {
  return JSON.parse(readFileSync(new URL(path, projectRoot), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
