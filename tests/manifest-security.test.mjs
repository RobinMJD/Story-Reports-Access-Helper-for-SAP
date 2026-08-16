import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const background = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
const core = readFileSync(new URL("../src/core.js", import.meta.url), "utf8");
const content = readFileSync(new URL("../src/ias-content.js", import.meta.url), "utf8");
const sfActivation = readFileSync(new URL("../src/sf-activation.js", import.meta.url), "utf8");
const popupHtml = readFileSync(new URL("../src/popup.html", import.meta.url), "utf8");
const popup = readFileSync(new URL("../src/popup.js", import.meta.url), "utf8");

const IAS_MATCHES = [
  "https://*.accounts.ondemand.com/*",
  "https://*.accounts400.ondemand.com/*",
  "https://*.accounts.cloud.sap/*",
  "https://*.accounts400.cloud.sap/*",
  "https://*.accounts.sapcloud.cn/*"
];

const SF_HOST_PERMISSIONS = [
  "https://*.successfactors.com/*",
  "https://*.successfactors.eu/*",
  "https://*.successfactors.cn/*",
  "https://*.sapsf.com/*",
  "https://*.sapsf.eu/*",
  "https://*.sapsf.cn/*",
  "https://*.hr.cloud.sap/*",
  "https://*.sapcloud.cn/*"
];

const SF_REPORT_CENTER_MATCHES = SF_HOST_PERMISSIONS.map((pattern) =>
  `${pattern.slice(0, -1)}xi/ui/reportcenter/pages/reportCenter.xhtml*`
);

test("manifest keeps required permissions narrow and limits SuccessFactors access to reviewed families", () => {
  assert.deepEqual(manifest.permissions, ["storage", "alarms", "contentSettings"]);
  assert.equal(manifest.optional_permissions, undefined);
  assert.deepEqual(manifest.host_permissions, SF_HOST_PERMISSIONS);
  assert.equal(manifest.incognito, "not_allowed");
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.version_name, "1.0.0");
  assert.equal(manifest.content_scripts.length, 2);
  assert.deepEqual(manifest.content_scripts[0].matches, IAS_MATCHES);
  assert.equal(manifest.content_scripts[0].all_frames, true);
  assert.equal(manifest.content_scripts[0].match_about_blank, false);
  assert.equal(manifest.content_scripts[0].match_origin_as_fallback, false);
  assert.deepEqual(manifest.content_scripts[1].matches, SF_REPORT_CENTER_MATCHES);
  assert.deepEqual(manifest.content_scripts[1].js, ["src/sf-activation.js"]);
  assert.equal(manifest.content_scripts[1].all_frames, false);
  assert.equal(manifest.content_scripts[1].run_at, "document_start");
  assert.equal(manifest.content_scripts[1].match_about_blank, false);
  assert.equal(manifest.content_scripts[1].match_origin_as_fallback, false);
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.equal(manifest.permissions.includes("scripting"), false);
  assert.equal(manifest.permissions.includes("management"), false);
  assert.equal(manifest.permissions.includes("webNavigation"), false);
});

test("pre-existing Story recovery is marker-bound, focused, write-ahead, and one reload only", () => {
  assert.match(sfActivation, /const BUILD = "1\.0\.0"/);
  assert.match(sfActivation, /const PROTOCOL = 1/);
  assert.match(sfActivation, /window\.top !== window/);
  assert.match(sfActivation, /sender\?\.id !== chrome\.runtime\.id/);
  assert.match(sfActivation, /message\.type !== "sf-activation-probe"/);
  assert.doesNotMatch(sfActivation, /\b(?:document|fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage)\b/);

  assert.match(background, /chrome\.runtime\.onInstalled\.addListener/);
  assert.match(background, /details\?\.reason !== "install"/);
  assert.match(background, /chrome\.tabs\.onActivated\.addListener/);
  assert.match(background, /lastFocusedWindow: true/);
  assert.match(background, /url: SF_ACTIVE_STORY_QUERY_PATTERNS/);
  assert.match(background, /isExactStoryReportUrl\(tab\.url\)/);
  assert.match(background, /chrome\.windows\.get\(windowId\)/);
  assert.match(background, /browserWindow\.focused === true/);
  assert.match(background, /makeActivationRecoveryAttempt\(tabId, SF_ACTIVATION_BUILD\)/);
  assert.match(background, /chrome\.tabs\.reload\(tabId, \{ bypassCache: false \}\)/);
  assert.equal((background.match(/chrome\.tabs\.reload\s*\(/g) || []).length, 1);
  assert.doesNotMatch(background, /chrome\.tabs\.(?:create|remove)\s*\(/);
  const claim = background.indexOf("state.activationAttempts.push(attempt)");
  const reload = background.indexOf("chrome.tabs.reload(tabId, { bypassCache: false })");
  assert.ok(claim >= 0 && reload > claim, "recovery tombstone must precede reload");
});

test("IAS detection is nested-frame only and never intercepts a top-level SAP helper page", () => {
  assert.match(content, /if \(window\.top === window\) return;/);
  assert.match(content, /ancestorOrigins/);
  assert.match(content, /origins\[origins\.length - 1\]/);
  assert.match(content, /sender\?\.id !== chrome\.runtime\.id/);
  assert.match(content, /grantContainer\.contains\(confirmButton\)/);
  assert.doesNotMatch(content, /event\.isTrusted/);
  assert.doesNotMatch(content, /stopImmediatePropagation/);
  assert.doesNotMatch(content, /interactStorageAccess/);
  assert.doesNotMatch(content, /requestStorageAccess\s*\(/);
  assert.doesNotMatch(content, /resume-source-document/);
  assert.doesNotMatch(content, /\.click\s*\(/);
});

test("automatic continuation uses one exact-document durable native replay barrier", () => {
  assert.match(content, /message\?\.type === "resume-with-cookie-exception"/);
  assert.match(content, /hasExactKeys\(message, \["resumeAttemptId", "type"\]\)/);
  assert.match(content, /HTMLFormElement\.prototype\.submit\.call\(interstitial\.replayForm\)/);
  assert.equal(
    (content.match(/HTMLFormElement\.prototype\.submit\.call\(/g) || []).length,
    1,
    "there must be exactly one reviewed native submit call site"
  );
  assert.match(content, /Array\.from\(replayForm\.elements\)/);
  assert.doesNotMatch(content, /requestSubmit\s*\(/);
  assert.doesNotMatch(content, /\.value\b/);
  assert.doesNotMatch(content, /\b(?:FormData|cookieStore)\b/);
  assert.match(content, /type: "replay-schedule-ready"/);
  assert.match(content, /response\.code === "replay-schedule-committed"/);
  assert.match(content, /replayGate\.then\(\(\) => submitReplayPlan\(result\)\)/);
  assert.match(content, /sendResponse\(result\.response\)/);

  assert.match(background, /hasExactKeys\(message, \["resumeAttemptId", "type"\]\)/);
  assert.match(background, /handleReplayScheduleReady\(message, sender\)/);
  assert.match(background, /documentId: claimed\.sourceDocumentId/);
  assert.match(background, /appendRecentResult\(state, workflow, "replay-scheduled"\)/);
  assert.match(background, /isMatchingReplaySchedule/);
  assert.match(background, /readStateAfterPendingWrites/);
  assert.match(background, /const initializationPromise = initializeBackground\(\)/);
  assert.match(background, /initializationPromise\s*\.then\(\(\) => dispatchMessage\(message, sender\)\)/s);
  assert.doesNotMatch(background, /setInterval\s*\(/);
});

test("the runtime has no helper or fresh-tab recovery path", () => {
  const runtime = `${background}\n${core}\n${content}\n${sfActivation}\n${popup}`;
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
    assert.equal(runtime.includes(legacy), false, `legacy runtime token remains: ${legacy}`);
  }
  assert.doesNotMatch(background, /chrome\.tabs\.(?:create|remove)\s*\(/);
});

test("automatic allowances remain exact, bounded, expiring, and locally protected", () => {
  assert.match(background, /chrome\.contentSettings(?:\?\.)?\.cookies\.get\s*\(/);
  assert.match(background, /\bcookies\.set\s*\(/);
  assert.match(background, /\bcookies\.clear\s*\(/);
  assert.match(background, /scope: "regular"/);
  assert.match(background, /accessLevel: "TRUSTED_CONTEXTS"/);
  assert.match(core, /export const RELIABLE_RULE_TTL_MS = 60 \* 60 \* 1000/);
  assert.match(core, /export const MAX_RELIABLE_PAIRS = 20/);
  assert.match(core, /expiresAt: now \+ RELIABLE_RULE_TTL_MS/);
  assert.match(core, /\.slice\(0, MAX_RELIABLE_PAIRS\)/);
  assert.match(core, /primaryPattern: `https:\/\/\$\{iasUrl\.hostname\}:443\/\*`/);
  assert.match(core, /secondaryPattern: `https:\/\/\$\{sourceUrl\.hostname\}:443\/\*`/);
  assert.doesNotMatch(core, /[`'"]https:\/\/\*\.(?:accounts|successfactors|sapsf|sapcloud|cloud\.sap)/);
  assert.doesNotMatch(core, /<all_urls>/);
  assert.doesNotMatch(`${background}\n${content}\n${popup}`, /chrome\.cookies\b/);
  assert.doesNotMatch(`${core}\n${content}\n${popup}`, /chrome\.contentSettings\b/);
});

test("v1 has no hidden pause mode and removes the exact legacy marker on startup", () => {
  const runtime = `${background}\n${core}\n${popup}`;
  assert.doesNotMatch(runtime, /pause-automatic-fixing|resume-automatic-fixing/);
  assert.doesNotMatch(runtime, /automaticPauseRequested|automaticGeneration/);
  assert.doesNotMatch(core, /RELIABLE_CONTROL_KEY|makeReliableModeControl|parseReliableModeControl/);
  assert.match(background, /const LEGACY_RELIABLE_CONTROL_KEY = "sapIasReliableModeControl\.v1"/);
  assert.ok(
    background.indexOf("await removeLegacyPauseMarker();") <
      background.indexOf("await reconcileAutomaticAllowances();"),
    "legacy pause migration must run before normal allowance reconciliation"
  );
  assert.match(background, /chrome\.storage\.local\.remove\(LEGACY_RELIABLE_CONTROL_KEY\)/);
  assert.doesNotMatch(popup, /chrome\.permissions\.(?:request|remove)\s*\(/);
});

test("popup help opens only the fixed public SAP KBA without broad tabs permission", () => {
  const expected = "https://userapps.support.sap.com/sap/support/knowledge/en/3039244";
  assert.match(popupHtml, /Open SAP help article/);
  assert.match(popup, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(popup, /chrome\.tabs\.create\(\{ url: SAP_KB_URL \}\)/);
  assert.equal((popup.match(/chrome\.tabs\.create\s*\(/g) || []).length, 1);
  assert.equal(manifest.permissions.includes("tabs"), false);
});

test("popup contains no tenant setup or technical recovery surface", () => {
  assert.doesNotMatch(popupHtml, /<(?:input|select|textarea)\b/i);
  assert.doesNotMatch(popupHtml, /\b(?:IAS|contentSettings|cookie|origin|replay|durable|reliable mode|recovery)\b/i);
  assert.doesNotMatch(popup, /\b(?:open-fresh-report-center|recoveryOfferId|helper-ready|helper-open)\b/);
});
