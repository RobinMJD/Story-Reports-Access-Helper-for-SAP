export const STATE_KEY = "sapIasStorageAccessWorkflows.v9";
export const STATE_VERSION = 9;
export const RELIABLE_LEDGER_KEY = "sapIasCookieExceptionLedger.v1";
export const RELIABLE_LEDGER_VERSION = 1;
export const RELIABLE_ALARM_NAME = "sapIasCookieExceptionExpiry.v1";
export const RELIABLE_RULE_TTL_MS = 60 * 60 * 1000;
export const MAX_RELIABLE_PAIRS = 20;
export const WORKFLOW_TTL_MS = 10 * 60 * 1000;
export const RECENT_TTL_MS = 10 * 60 * 1000;
export const MAX_ACTIVE_WORKFLOWS = 4;
export const MAX_RECENT_RESULTS = 20;
export const MAX_ACTIVATION_RECOVERY_ATTEMPTS = 20;
export const STORY_REPORT_PATH = "/xi/ui/reportcenter/pages/reportCenter.xhtml";
export const STORY_REPORT_HASH = "#/story/execute/action";

export const IAS_PARENT_DOMAINS = Object.freeze([
  "accounts.ondemand.com",
  "accounts400.ondemand.com",
  "accounts.cloud.sap",
  "accounts400.cloud.sap",
  "accounts.sapcloud.cn"
]);

export const SUCCESSFACTORS_HOST_SUFFIXES = Object.freeze([
  ".successfactors.com",
  ".successfactors.eu",
  ".successfactors.cn",
  ".sapsf.com",
  ".sapsf.eu",
  ".sapsf.cn",
  ".hr.cloud.sap",
  ".sapcloud.cn"
]);

const DIRECT_WORKFLOW_STATUSES = new Set(["direct-preparing", "direct-resuming"]);
const RESULT_CODES = new Set([
  "idle",
  "page-refreshing",
  "page-prepared",
  "continuation-in-progress",
  "replay-scheduled",
  "automatic-fix-blocked",
  "resume-interrupted",
  "source-changed",
  "limit-reached",
  "incognito-not-supported",
  "error"
]);

export function parseIasUrl(value) {
  const url = parseHttpsUrl(value);
  if (!url) return null;
  const hostname = url.hostname.toLowerCase();
  const parentDomain = IAS_PARENT_DOMAINS.find(
    (candidate) => hostname !== candidate && hostname.endsWith(`.${candidate}`)
  );
  if (!parentDomain) return null;
  return url;
}

export function parseSuccessFactorsOrigin(value) {
  const url = parseHttpsUrl(value);
  if (!url || url.pathname !== "/" || url.search || url.hash) return null;
  const hostname = url.hostname.toLowerCase();
  if (IAS_PARENT_DOMAINS.some((parent) => hostname === parent || hostname.endsWith(`.${parent}`))) return null;
  const allowed = SUCCESSFACTORS_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
  return allowed ? url.origin : null;
}

export function isExactStoryReportUrl(value) {
  if (!isSupportedReportCenterUrl(value)) return false;
  const url = new URL(String(value));
  return url.hash === STORY_REPORT_HASH;
}

export function isSupportedReportCenterUrl(value) {
  const url = parseHttpsUrl(value);
  if (!url || url.pathname !== STORY_REPORT_PATH || url.search) return false;
  if (url.hash && !url.hash.startsWith("#/")) return false;
  const hostname = url.hostname.toLowerCase();
  if (IAS_PARENT_DOMAINS.some((parent) => hostname === parent || hostname.endsWith(`.${parent}`))) return false;
  return SUCCESSFACTORS_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

export function makeCookieExceptionPair(iasOrigin, sourceOrigin) {
  const iasUrl = parseIasUrl(iasOrigin);
  const parsedSourceOrigin = parseSuccessFactorsOrigin(sourceOrigin);
  if (!iasUrl || iasUrl.href !== `${iasUrl.origin}/` || !parsedSourceOrigin) return null;
  const sourceUrl = new URL(parsedSourceOrigin);
  return {
    iasOrigin: iasUrl.origin,
    sourceOrigin: sourceUrl.origin,
    primaryPattern: `https://${iasUrl.hostname}:443/*`,
    secondaryPattern: `https://${sourceUrl.hostname}:443/*`,
    primaryUrl: `${iasUrl.origin}/`,
    secondaryUrl: `${sourceUrl.origin}/`
  };
}

export function isSafeResumeAttemptId(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}

export function createEmptyReliableLedger() {
  return { version: RELIABLE_LEDGER_VERSION, entries: [] };
}

export function makeReliableLedgerEntry(iasOrigin, sourceOrigin, now = Date.now()) {
  const pair = makeCookieExceptionPair(iasOrigin, sourceOrigin);
  if (!pair || !Number.isFinite(now) || now <= 0) return null;
  return {
    iasOrigin: pair.iasOrigin,
    sourceOrigin: pair.sourceOrigin,
    primaryPattern: pair.primaryPattern,
    secondaryPattern: pair.secondaryPattern,
    createdAt: now,
    expiresAt: now + RELIABLE_RULE_TTL_MS
  };
}

export function pruneReliableLedger(rawLedger, now = Date.now()) {
  const ledger = createEmptyReliableLedger();
  if (
    !rawLedger ||
    typeof rawLedger !== "object" ||
    rawLedger.version !== RELIABLE_LEDGER_VERSION ||
    !Array.isArray(rawLedger.entries)
  ) {
    return ledger;
  }

  const byPair = new Map();
  for (const value of rawLedger.entries) {
    const entry = sanitizeReliableEntry(value, now);
    if (!entry) continue;
    const key = reliablePairKey(entry.iasOrigin, entry.sourceOrigin);
    const existing = byPair.get(key);
    if (!existing || entry.expiresAt > existing.expiresAt) byPair.set(key, entry);
  }
  ledger.entries = [...byPair.values()]
    .sort((left, right) => {
      const leftKey = reliablePairKey(left.iasOrigin, left.sourceOrigin);
      const rightKey = reliablePairKey(right.iasOrigin, right.sourceOrigin);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    })
    .slice(0, MAX_RELIABLE_PAIRS);
  return ledger;
}

export function createEmptyState() {
  return {
    version: STATE_VERSION,
    workflows: [],
    recent: [],
    activationAttempts: [],
    lastStatus: { code: "idle", at: 0 }
  };
}

export function pruneSessionState(rawState, now = Date.now()) {
  const state = createEmptyState();
  if (!rawState || typeof rawState !== "object" || rawState.version !== STATE_VERSION) return state;

  state.workflows = Array.isArray(rawState.workflows)
    ? rawState.workflows
        .map((workflow) => sanitizeWorkflow(workflow, now))
        .filter((workflow) => workflow && now - workflow.createdAt <= WORKFLOW_TTL_MS)
        .slice(-MAX_ACTIVE_WORKFLOWS)
    : [];

  state.recent = Array.isArray(rawState.recent)
    ? rawState.recent
        .map((entry) => sanitizeRecent(entry, now))
        .filter((entry) => entry && now - entry.at <= RECENT_TTL_MS)
        .slice(-MAX_RECENT_RESULTS)
    : [];

  state.activationAttempts = Array.isArray(rawState.activationAttempts)
    ? sanitizeActivationAttempts(rawState.activationAttempts, now).slice(0, MAX_ACTIVATION_RECOVERY_ATTEMPTS)
    : [];

  const lastStatus = sanitizeLastStatus(rawState.lastStatus, now);
  if (lastStatus && now - lastStatus.at <= RECENT_TTL_MS) state.lastStatus = lastStatus;
  return state;
}

export function makeActivationRecoveryAttempt(
  tabId,
  version,
  at = Date.now(),
  phase = "reload-pending"
) {
  if (
    !isPositiveInteger(tabId) ||
    !isSafeExtensionVersion(version) ||
    !Number.isFinite(at) ||
    at <= 0 ||
    !["reload-scheduled", "reload-pending", "reload-attempted"].includes(phase)
  ) return null;
  return { tabId, version, at, phase };
}

export function isSameWorkflow(workflow, sourceTabId, sourceFrameId, sourceDocumentId, iasOrigin, sourceOrigin) {
  return (
    workflow.sourceTabId === sourceTabId &&
    workflow.sourceFrameId === sourceFrameId &&
    workflow.sourceDocumentId === sourceDocumentId &&
    workflow.iasOrigin === iasOrigin &&
    workflow.sourceOrigin === sourceOrigin
  );
}

export function makeRecentResult(workflow, outcome, at = Date.now()) {
  const result = {
    sourceTabId: workflow.sourceTabId,
    sourceWindowId: workflow.sourceWindowId,
    sourceFrameId: workflow.sourceFrameId,
    sourceDocumentId: workflow.sourceDocumentId,
    iasOrigin: workflow.iasOrigin,
    sourceOrigin: workflow.sourceOrigin,
    outcome: RESULT_CODES.has(outcome) ? outcome : "error",
    at
  };
  if (isSafeResumeAttemptId(workflow.resumeAttemptId)) {
    result.resumeAttemptId = workflow.resumeAttemptId;
  }
  return result;
}

export function makeLastStatus(code, at = Date.now()) {
  return {
    code: RESULT_CODES.has(code) ? code : "error",
    at
  };
}

function parseHttpsUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

function sanitizeWorkflow(value, now) {
  if (!value || typeof value !== "object") return null;
  if (!isPositiveInteger(value.sourceTabId)) return null;
  if (!Number.isInteger(value.sourceWindowId) || value.sourceWindowId < 0) return null;
  if (!Number.isInteger(value.sourceFrameId) || value.sourceFrameId <= 0) return null;
  if (!isSafeDocumentId(value.sourceDocumentId)) return null;
  const iasUrl = parseIasUrl(value.iasOrigin);
  const sourceOrigin = parseSuccessFactorsOrigin(value.sourceOrigin);
  if (!iasUrl || iasUrl.href !== `${iasUrl.origin}/` || !sourceOrigin) return null;
  if (!Number.isFinite(value.createdAt) || value.createdAt <= 0 || value.createdAt > now) return null;

  const workflow = {
    mode: value.mode,
    sourceTabId: value.sourceTabId,
    sourceWindowId: value.sourceWindowId,
    sourceFrameId: value.sourceFrameId,
    sourceDocumentId: value.sourceDocumentId,
    iasOrigin: iasUrl.origin,
    sourceOrigin,
    createdAt: value.createdAt,
    status: value.status
  };

  if (value.mode !== "direct" || !DIRECT_WORKFLOW_STATUSES.has(value.status)) return null;
  const resumeRequestedAt = positiveTimestamp(value.resumeRequestedAt, now);
  const resumeAttemptId = isSafeResumeAttemptId(value.resumeAttemptId) ? value.resumeAttemptId : null;
  if (value.status === "direct-preparing" && (resumeRequestedAt || resumeAttemptId)) return null;
  if (value.status === "direct-resuming" && (!resumeRequestedAt || !resumeAttemptId)) return null;
  if (value.resumeAttemptId !== undefined && !resumeAttemptId) return null;
  if (resumeRequestedAt && resumeRequestedAt < value.createdAt) return null;
  if (resumeRequestedAt) workflow.resumeRequestedAt = resumeRequestedAt;
  if (resumeAttemptId) workflow.resumeAttemptId = resumeAttemptId;
  return workflow;
}

function sanitizeRecent(value, now) {
  if (!value || typeof value !== "object" || !isPositiveInteger(value.sourceTabId)) return null;
  if (!Number.isInteger(value.sourceWindowId) || value.sourceWindowId < 0) return null;
  if (!Number.isInteger(value.sourceFrameId) || value.sourceFrameId <= 0) return null;
  if (!isSafeDocumentId(value.sourceDocumentId)) return null;
  const iasUrl = parseIasUrl(value.iasOrigin);
  const sourceOrigin = parseSuccessFactorsOrigin(value.sourceOrigin);
  if (!iasUrl || iasUrl.href !== `${iasUrl.origin}/` || !sourceOrigin) return null;
  if (!RESULT_CODES.has(value.outcome) || !Number.isFinite(value.at) || value.at <= 0 || value.at > now) return null;
  const resumeAttemptId = isSafeResumeAttemptId(value.resumeAttemptId) ? value.resumeAttemptId : null;
  if (value.outcome === "replay-scheduled" && !resumeAttemptId) return null;
  if (value.resumeAttemptId !== undefined && !resumeAttemptId) return null;
  const recent = {
    sourceTabId: value.sourceTabId,
    sourceWindowId: value.sourceWindowId,
    sourceFrameId: value.sourceFrameId,
    sourceDocumentId: value.sourceDocumentId,
    iasOrigin: iasUrl.origin,
    sourceOrigin,
    outcome: value.outcome,
    at: value.at
  };
  if (resumeAttemptId) recent.resumeAttemptId = resumeAttemptId;
  return recent;
}

function sanitizeLastStatus(value, now) {
  if (!value || typeof value !== "object") return null;
  if (!RESULT_CODES.has(value.code) || !Number.isFinite(value.at) || value.at < 0 || value.at > now) return null;
  return { code: value.code, at: value.at };
}

function sanitizeActivationAttempts(values, now) {
  const attempts = [];
  const seen = new Set();
  for (const value of values) {
    const attempt = makeActivationRecoveryAttempt(
      value?.tabId,
      value?.version,
      value?.at,
      value?.phase
    );
    if (!attempt || attempt.at > now) continue;
    const key = `${attempt.tabId}\u0000${attempt.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    attempts.push(attempt);
  }
  return attempts;
}

function sanitizeReliableEntry(value, now) {
  if (!value || typeof value !== "object") return null;
  const pair = makeCookieExceptionPair(value.iasOrigin, value.sourceOrigin);
  if (!pair) return null;
  if (value.primaryPattern !== pair.primaryPattern || value.secondaryPattern !== pair.secondaryPattern) return null;
  const createdAt = positiveTimestamp(value.createdAt);
  const expiresAt = positiveTimestamp(value.expiresAt);
  if (!createdAt || !expiresAt || createdAt > now || expiresAt <= now || expiresAt <= createdAt) return null;
  if (expiresAt - createdAt > RELIABLE_RULE_TTL_MS) return null;
  return {
    iasOrigin: pair.iasOrigin,
    sourceOrigin: pair.sourceOrigin,
    primaryPattern: pair.primaryPattern,
    secondaryPattern: pair.secondaryPattern,
    createdAt,
    expiresAt
  };
}

function reliablePairKey(iasOrigin, sourceOrigin) {
  return `${iasOrigin}\u0000${sourceOrigin}`;
}

function positiveTimestamp(value, maximum = Number.POSITIVE_INFINITY) {
  return Number.isFinite(value) && value > 0 && value <= maximum ? value : null;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isSafeDocumentId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSafeExtensionVersion(value) {
  return typeof value === "string" && /^\d{1,6}(?:\.\d{1,6}){1,3}$/.test(value);
}
