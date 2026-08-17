import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ACTIVATION_RECOVERY_ATTEMPTS,
  MAX_ACTIVE_WORKFLOWS,
  MAX_RECENT_RESULTS,
  MAX_RELIABLE_PAIRS,
  RECENT_TTL_MS,
  RELIABLE_LEDGER_VERSION,
  RELIABLE_RULE_TTL_MS,
  STATE_KEY,
  STATE_VERSION,
  STORY_REPORT_HASH,
  STORY_REPORT_PATH,
  WORKFLOW_TTL_MS,
  createEmptyReliableLedger,
  createEmptyState,
  isExactStoryReportUrl,
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
} from "../src/core.js";

const IAS_ORIGIN = "https://tenant.accounts.ondemand.com";
const SF_ORIGIN = "https://sampletenant.successfactors.eu";
const ATTEMPT_ID = "123e4567-e89b-42d3-a456-426614174000";

test("v9 identifiers and empty state expose only bounded direct runtime state", () => {
  assert.equal(STATE_VERSION, 9);
  assert.equal(STATE_KEY, "sapIasStorageAccessWorkflows.v9");
  assert.deepEqual(createEmptyState(), {
    version: 9,
    workflows: [],
    recent: [],
    activationAttempts: [],
    lastStatus: { code: "idle", at: 0 }
  });
  assert.deepEqual(createEmptyReliableLedger(), { version: RELIABLE_LEDGER_VERSION, entries: [] });
});

test("Story Report activation URLs require an exact standard route on an allowed SuccessFactors host", () => {
  assert.equal(STORY_REPORT_PATH, "/xi/ui/reportcenter/pages/reportCenter.xhtml");
  assert.equal(STORY_REPORT_HASH, "#/story/execute/action");
  for (const hostname of [
    "company.successfactors.com",
    "company.successfactors.eu",
    "company.successfactors.cn",
    "company.sapsf.com",
    "company.sapsf.eu",
    "company.sapsf.cn",
    "company.hr.cloud.sap",
    "company.sapcloud.cn"
  ]) {
    assert.equal(
      isExactStoryReportUrl(`https://${hostname}:443${STORY_REPORT_PATH}${STORY_REPORT_HASH}`),
      true,
      hostname
    );
  }
  for (const value of [
    `http://company.sapsf.eu${STORY_REPORT_PATH}${STORY_REPORT_HASH}`,
    `https://company.sapsf.eu:8443${STORY_REPORT_PATH}${STORY_REPORT_HASH}`,
    `https://user@company.sapsf.eu${STORY_REPORT_PATH}${STORY_REPORT_HASH}`,
    `https://sapsf.eu${STORY_REPORT_PATH}${STORY_REPORT_HASH}`,
    `https://company.sapsf.eu.evil.example${STORY_REPORT_PATH}${STORY_REPORT_HASH}`,
    `https://company.sapsf.eu${STORY_REPORT_PATH}/extra${STORY_REPORT_HASH}`,
    `https://company.sapsf.eu${STORY_REPORT_PATH}?x=1${STORY_REPORT_HASH}`,
    `https://company.sapsf.eu${STORY_REPORT_PATH}#/story/execute/action/extra`,
    `https://company.sapsf.eu${STORY_REPORT_PATH}#/home`,
    `https://company.sapsf.eu${STORY_REPORT_PATH}`
  ]) {
    assert.equal(isExactStoryReportUrl(value), false, value);
  }
});

test("Report Center recovery accepts only the exact document path and its SAP hash routes", () => {
  for (const route of ["", "#/home", "#/home?tab=myreports&view=reports", STORY_REPORT_HASH]) {
    assert.equal(
      isSupportedReportCenterUrl(`https://company.successfactors.eu${STORY_REPORT_PATH}${route}`),
      true,
      route
    );
  }
  for (const value of [
    `https://company.successfactors.eu${STORY_REPORT_PATH}?outside=hash#/home`,
    `https://company.successfactors.eu${STORY_REPORT_PATH}#home`,
    `https://company.successfactors.eu${STORY_REPORT_PATH}/extra#/home`,
    `https://company.successfactors.eu.evil.example${STORY_REPORT_PATH}#/home`,
    `https://company.successfactors.eu:8443${STORY_REPORT_PATH}#/home`,
    `http://company.successfactors.eu${STORY_REPORT_PATH}#/home`
  ]) {
    assert.equal(isSupportedReportCenterUrl(value), false, value);
  }
});

test("activation attempt tombstones are exact, deduplicated, future-rejecting, and bounded without eviction", () => {
  const now = 1_900_000_000_000;
  assert.deepEqual(makeActivationRecoveryAttempt(10, "1.1.1", now), {
    tabId: 10,
    version: "1.1.1",
    at: now,
    phase: "reload-pending"
  });
  assert.deepEqual(makeActivationRecoveryAttempt(10, "1.1.1", now, "reload-attempted"), {
    tabId: 10,
    version: "1.1.1",
    at: now,
    phase: "reload-attempted"
  });
  assert.deepEqual(makeActivationRecoveryAttempt(10, "1.1.1", now, "reload-scheduled"), {
    tabId: 10,
    version: "1.1.1",
    at: now,
    phase: "reload-scheduled"
  });
  assert.equal(makeActivationRecoveryAttempt(0, "1.1.1", now), null);
  assert.equal(makeActivationRecoveryAttempt(10, "1.1.1-beta", now), null);
  assert.equal(makeActivationRecoveryAttempt(10, "1.1.1", 0), null);
  assert.equal(makeActivationRecoveryAttempt(10, "1.1.1", now, "unknown"), null);

  const attempts = Array.from({ length: MAX_ACTIVATION_RECOVERY_ATTEMPTS + 2 }, (_, index) => ({
    tabId: index + 1,
    version: "1.1.1",
    at: now - index,
    url: "https://must-not-survive.example",
    title: "must not survive",
    windowId: 99
  }));
  const state = pruneSessionState({
    ...createEmptyState(),
    activationAttempts: [
      attempts[0],
      { ...attempts[0], at: now + 500 },
      { tabId: -1, version: "1.1.1", at: now },
      { tabId: 500, version: "unsafe", at: now },
      { tabId: 501, version: "1.1.1", at: 0 },
      { tabId: 502, version: "1.1.1", at: now + 1 },
      ...attempts.slice(1)
    ]
  }, now);

  assert.equal(state.activationAttempts.length, MAX_ACTIVATION_RECOVERY_ATTEMPTS);
  assert.deepEqual(state.activationAttempts[0], {
    tabId: 1,
    version: "1.1.1",
    at: now,
    phase: "reload-pending"
  });
  assert.deepEqual(Object.keys(state.activationAttempts[0]).sort(), ["at", "phase", "tabId", "version"]);
  assert.equal(state.activationAttempts.at(-1).tabId, MAX_ACTIVATION_RECOVERY_ATTEMPTS);
  assert.equal(state.activationAttempts.some((attempt) => attempt.tabId > MAX_ACTIVATION_RECOVERY_ATTEMPTS), false);
});

test("IAS and SuccessFactors origins are exact HTTPS origins without ports or lookalikes", () => {
  assert.equal(parseIasUrl(`${IAS_ORIGIN}/saml2/idp/sso/tenant`)?.origin, IAS_ORIGIN);
  assert.equal(parseSuccessFactorsOrigin(SF_ORIGIN), SF_ORIGIN);

  for (const value of [
    "http://tenant.accounts.ondemand.com/path",
    "https://accounts.ondemand.com/path",
    "https://tenant.accounts.ondemand.com.evil.example/path",
    "https://tenant.accounts.ondemand.com:8443/path",
    "https://user@tenant.accounts.ondemand.com/path"
  ]) {
    assert.equal(parseIasUrl(value), null, value);
  }

  for (const value of [
    "http://sampletenant.successfactors.eu",
    "https://successfactors.eu",
    "https://sampletenant.successfactors.eu.evil.example",
    "https://sampletenant.successfactors.eu:8443",
    "https://sampletenant.successfactors.eu/path",
    "https://sampletenant.successfactors.eu?x=1"
  ]) {
    assert.equal(parseSuccessFactorsOrigin(value), null, value);
  }
});

test("cookie exception pairs are canonical exact host:443 patterns", () => {
  assert.deepEqual(makeCookieExceptionPair(IAS_ORIGIN, SF_ORIGIN), {
    iasOrigin: IAS_ORIGIN,
    sourceOrigin: SF_ORIGIN,
    primaryPattern: "https://tenant.accounts.ondemand.com:443/*",
    secondaryPattern: "https://sampletenant.successfactors.eu:443/*",
    primaryUrl: `${IAS_ORIGIN}/`,
    secondaryUrl: `${SF_ORIGIN}/`
  });
  assert.equal(makeCookieExceptionPair(`${IAS_ORIGIN}/path`, SF_ORIGIN), null);
  assert.equal(makeCookieExceptionPair(IAS_ORIGIN, `${SF_ORIGIN}/path`), null);
});

test("session sanitation accepts only bounded, current, internally consistent direct workflows", () => {
  const now = 1_900_000_000_000;
  const preparing = makeWorkflow(now - 1_000);
  const resuming = {
    ...makeWorkflow(now - 900),
    sourceTabId: 11,
    sourceDocumentId: "source-doc-2",
    status: "direct-resuming",
    resumeRequestedAt: now - 800,
    resumeAttemptId: ATTEMPT_ID
  };
  const overflow = Array.from({ length: MAX_ACTIVE_WORKFLOWS + 2 }, (_, index) => ({
    ...preparing,
    sourceTabId: 20 + index,
    sourceDocumentId: `source-doc-${20 + index}`,
    createdAt: now - 700 + index
  }));

  const state = pruneSessionState(
    {
      version: STATE_VERSION,
      workflows: [
        preparing,
        resuming,
        { ...preparing, createdAt: now + 1 },
        { ...preparing, sourceFrameId: 0 },
        { ...preparing, status: "direct-resuming" },
        { ...resuming, resumeRequestedAt: resuming.createdAt - 1 },
        ...overflow
      ],
      recent: [],
      lastStatus: { code: "continuation-in-progress", at: now - 1 }
    },
    now
  );

  assert.equal(state.workflows.length, MAX_ACTIVE_WORKFLOWS);
  assert.deepEqual(
    state.workflows.map((workflow) => workflow.sourceTabId),
    overflow.slice(-MAX_ACTIVE_WORKFLOWS).map((workflow) => workflow.sourceTabId)
  );
  assert.deepEqual(state.lastStatus, { code: "continuation-in-progress", at: now - 1 });
  assert.deepEqual(pruneSessionState({ version: STATE_VERSION - 1, workflows: [preparing] }, now), createEmptyState());
});

test("recent replay tombstones require the exact safe attempt UUID and future timestamps fail closed", () => {
  const now = 1_900_000_000_000;
  const resuming = {
    ...makeWorkflow(now - 1_000),
    status: "direct-resuming",
    resumeRequestedAt: now - 900,
    resumeAttemptId: ATTEMPT_ID
  };
  const scheduled = makeRecentResult(resuming, "replay-scheduled", now - 100);
  const blocked = makeRecentResult(makeWorkflow(now - 1_000), "automatic-fix-blocked", now - 90);
  const many = Array.from({ length: MAX_RECENT_RESULTS + 2 }, (_, index) => ({
    ...blocked,
    sourceTabId: index + 1,
    sourceDocumentId: `doc-${index + 1}`,
    at: now - 70 + index
  }));
  const state = pruneSessionState(
    {
      version: STATE_VERSION,
      workflows: [],
      recent: [
        scheduled,
        blocked,
        { ...scheduled, resumeAttemptId: "bad" },
        { ...scheduled, resumeAttemptId: undefined },
        { ...blocked, at: now + 1 },
        { ...blocked, at: now - RECENT_TTL_MS - 1 },
        ...many
      ],
      lastStatus: { code: "replay-scheduled", at: now + 1 }
    },
    now
  );

  assert.equal(state.recent.length, MAX_RECENT_RESULTS);
  assert.equal(state.recent.some((entry) => entry.at > now), false);
  assert.deepEqual(state.lastStatus, { code: "idle", at: 0 });
  assert.equal(isSafeResumeAttemptId(ATTEMPT_ID), true);
  assert.equal(isSafeResumeAttemptId("123e4567-e89b-12d3-a456-426614174000"), false);
});

test("workflow identity binds tab, frame, document, IAS, and SuccessFactors origins", () => {
  const workflow = makeWorkflow(Date.now());
  assert.equal(
    isSameWorkflow(workflow, 10, 7, "source-doc-1", IAS_ORIGIN, SF_ORIGIN),
    true
  );
  assert.equal(isSameWorkflow(workflow, 10, 8, "source-doc-1", IAS_ORIGIN, SF_ORIGIN), false);
  assert.equal(isSameWorkflow(workflow, 10, 7, "source-doc-2", IAS_ORIGIN, SF_ORIGIN), false);
  assert.equal(
    isSameWorkflow(workflow, 10, 7, "source-doc-1", IAS_ORIGIN, "https://other.successfactors.eu"),
    false
  );
});

test("allowance ledger enforces canonical pairs, hard one-hour TTL, future rejection, dedupe, and cap", () => {
  const now = 1_900_000_000_000;
  const first = makeReliableLedgerEntry(IAS_ORIGIN, SF_ORIGIN, now - 1_000);
  assert.equal(first.expiresAt - first.createdAt, RELIABLE_RULE_TTL_MS);
  const duplicate = { ...first, createdAt: now - 500, expiresAt: now + 500 };
  const entries = Array.from({ length: MAX_RELIABLE_PAIRS + 2 }, (_, index) =>
    makeReliableLedgerEntry(
      `https://tenant${index}.accounts.ondemand.com`,
      `https://company${index}.successfactors.eu`,
      now - 1_000
    )
  );
  const ledger = pruneReliableLedger(
    {
      version: RELIABLE_LEDGER_VERSION,
      entries: [
        first,
        duplicate,
        { ...first, createdAt: now + 1, expiresAt: now + RELIABLE_RULE_TTL_MS },
        { ...first, expiresAt: first.createdAt + RELIABLE_RULE_TTL_MS + 1 },
        { ...first, primaryPattern: "https://*.accounts.ondemand.com/*" },
        ...entries
      ]
    },
    now
  );

  assert.equal(ledger.entries.length, MAX_RELIABLE_PAIRS);
  assert.equal(
    ledger.entries.filter((entry) => entry.iasOrigin === IAS_ORIGIN && entry.sourceOrigin === SF_ORIGIN).length,
    1
  );
  assert.equal(ledger.entries.every((entry) => entry.createdAt <= now), true);
  assert.equal(ledger.entries.every((entry) => entry.expiresAt - entry.createdAt <= RELIABLE_RULE_TTL_MS), true);
});

test("last-status sanitation accepts only current public runtime outcomes", () => {
  const now = 1_900_000_000_000;
  assert.deepEqual(makeLastStatus("automatic-fix-blocked", now), {
    code: "automatic-fix-blocked",
    at: now
  });
  assert.deepEqual(makeLastStatus("not-a-runtime-outcome", now), { code: "error", at: now });
  assert.deepEqual(
    pruneSessionState(
      {
        version: STATE_VERSION,
        workflows: [],
        recent: [],
        lastStatus: { code: "automatic-fixing-ready", at: now - WORKFLOW_TTL_MS }
      },
      now
    ).lastStatus,
    { code: "idle", at: 0 }
  );
});

function makeWorkflow(createdAt) {
  return {
    mode: "direct",
    sourceTabId: 10,
    sourceWindowId: 1,
    sourceFrameId: 7,
    sourceDocumentId: "source-doc-1",
    iasOrigin: IAS_ORIGIN,
    sourceOrigin: SF_ORIGIN,
    createdAt,
    status: "direct-preparing"
  };
}
