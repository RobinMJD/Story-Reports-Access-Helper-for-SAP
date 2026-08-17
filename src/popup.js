const SAP_KB_URL = "https://userapps.support.sap.com/sap/support/knowledge/en/3039244";

const STATUS_REQUEST_TIMEOUT_MS = 1_000;
const STATUS_POLL_INTERVAL_MS = 500;
const STATUS_RETRY_INTERVAL_MS = 250;
const STATUS_FAILURE_THRESHOLD = 2;

const STATUS_COPY = Object.freeze({
  checking: ["Checking this report…", "This status updates automatically.", "checking"],
  idle: ["Extension ready", "Automatic help is active. Use the button only if the report is blank.", "neutral"],
  unsupported: ["Extension ready", "Open SAP Report Center to check a report.", "neutral"],
  waiting: ["Checking SAP…", "This status updates automatically.", "checking"],
  refreshing: ["Preparing this report…", "This status updates automatically.", "checking"],
  refreshStarted: ["Preparing this report…", "This status updates automatically.", "checking"],
  fixing: ["Applying access fix…", "This status updates automatically.", "checking"],
  alreadyWorking: ["Access fix is already running", "This status updates automatically.", "checking"],
  cooldown: ["Access fix is already starting", "This status updates automatically.", "checking"],
  prepared: ["Automatic help is ready", "The extension will continue if SAP requests access.", "active"],
  fixed: ["Access fix applied", "Browser access was prepared for this SAP site.", "success"],
  wrongPage: ["Open SAP Report Center", "Go to the report page, then try again.", "neutral"],
  manualFailed: ["Access fix could not start", "Try the report again or open the SAP help article.", "warning"],
  failed: ["Access fix not applied", "Use Fix this report if the Story Report is blank.", "warning"],
  unavailable: ["Couldn’t confirm status", "If the report is blank, you can still try the fix.", "checking"]
});

const FAILED_CODES = new Set([
  "automatic-fix-blocked",
  "resume-interrupted",
  "source-changed",
  "limit-reached",
  "incognito-not-supported",
  "error"
]);

let statusPollTimer = null;
let statusPollInFlight = false;
let renderGeneration = 0;
let consecutiveStatusFailures = 0;
let hasRenderedRuntimeStatus = false;

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("fix-report").addEventListener("click", forceFixCurrentReport);
  document.getElementById("sap-help").addEventListener("click", openSapHelpArticle);
  setStatusBusy(true);
  renderStatus("checking", false);
  setFixVisibility(false);

  const manifestVersion = chrome.runtime.getManifest?.().version;
  if (typeof manifestVersion === "string" && manifestVersion) {
    document.getElementById("version").textContent = `v${manifestVersion}`;
  }

  void pollPopupStatus();
});

async function pollPopupStatus() {
  if (statusPollInFlight) {
    scheduleStatusPoll(STATUS_RETRY_INTERVAL_MS);
    return;
  }

  statusPollInFlight = true;
  const generation = ++renderGeneration;
  const outcome = await sendRuntimeMessage({ type: "get-status" });
  statusPollInFlight = false;

  if (generation !== renderGeneration) return;

  const status = outcome.kind === "response"
    ? normalizeRuntimeResponse(outcome.response, true)
    : null;

  if (!status) {
    consecutiveStatusFailures += 1;
    if (consecutiveStatusFailures >= STATUS_FAILURE_THRESHOLD) {
      renderStatus("status-unavailable", true);
      setStatusBusy(true);
      setFixVisibility(true);
    } else if (!hasRenderedRuntimeStatus) {
      renderStatus("checking", false);
      setStatusBusy(true);
      setFixVisibility(false);
    }
    scheduleStatusPoll(STATUS_RETRY_INTERVAL_MS);
    return;
  }

  consecutiveStatusFailures = 0;
  hasRenderedRuntimeStatus = true;
  applyRuntimeStatus(status, outcome.response);
  scheduleStatusPoll(STATUS_POLL_INTERVAL_MS);
}

async function forceFixCurrentReport() {
  const action = document.getElementById("fix-action");
  const button = document.getElementById("fix-report");
  if (action.hidden || button.disabled) return;

  cancelScheduledStatusPoll();
  const generation = ++renderGeneration;
  button.disabled = true;
  button.setAttribute("aria-disabled", "true");
  button.setAttribute("aria-busy", "true");
  setStatusBusy(true);
  renderStatus("page-refreshing", false);

  const outcome = await sendRuntimeMessage({ type: "force-fix-current-tab" });
  if (generation !== renderGeneration) return;

  button.setAttribute("aria-busy", "false");
  const status = outcome.kind === "response"
    ? normalizeRuntimeResponse(outcome.response, false)
    : null;

  if (!status) {
    renderStatus("status-unavailable", true);
    setStatusBusy(true);
    setFixVisibility(true);
    scheduleStatusPoll(STATUS_RETRY_INTERVAL_MS);
    return;
  }

  consecutiveStatusFailures = 0;
  hasRenderedRuntimeStatus = true;
  applyRuntimeStatus(status, outcome.response);
  scheduleStatusPoll(STATUS_RETRY_INTERVAL_MS);
}

function applyRuntimeStatus(status, response) {
  renderStatus(status.code, status.canFixCurrentPage);
  setStatusBusy(isBusyStatus(status.code));
  setFixVisibility(shouldShowFix(status));
  if (typeof response?.version === "string" && response.version) {
    document.getElementById("version").textContent = `v${response.version}`;
  }
}

function openSapHelpArticle() {
  chrome.tabs.create({ url: SAP_KB_URL });
}

function renderStatus(code, canFixCurrentPage) {
  const state = statusStateForCode(code);
  const [title, defaultDetail, className] = STATUS_COPY[state];
  const detail = state === "failed" && canFixCurrentPage === false
    ? "Automatic help could not complete. This status updates automatically."
    : defaultDetail;

  document.getElementById("status-title").textContent = title;
  document.getElementById("status-detail").textContent = detail;
  document.getElementById("status-dot").className = `status-dot ${className}`;
}

function statusStateForCode(code) {
  if (code === "checking") return "checking";
  if (code === "idle") return "idle";
  if (code === "unsupported-page") return "unsupported";
  if (code === "page-not-ready") return "waiting";
  if (code === "page-refreshing") return "refreshing";
  if (code === "manual-refresh-started") return "refreshStarted";
  if (code === "continuation-in-progress") return "fixing";
  if (code === "fix-in-progress") return "alreadyWorking";
  if (code === "manual-fix-cooldown") return "cooldown";
  if (code === "page-prepared") return "prepared";
  if (code === "replay-scheduled" || code === "fix-already-applied") return "fixed";
  if (code === "wrong-page") return "wrongPage";
  if (code === "manual-fix-failed") return "manualFailed";
  if (code === "check-unavailable" || code === "status-unavailable") return "unavailable";
  if (FAILED_CODES.has(code)) return "failed";
  return "unavailable";
}

function isBusyStatus(code) {
  return [
    "checking",
    "page-not-ready",
    "page-refreshing",
    "manual-refresh-started",
    "continuation-in-progress",
    "fix-in-progress",
    "manual-fix-cooldown",
    "check-unavailable",
    "status-unavailable"
  ].includes(code);
}

function shouldShowFix(status) {
  const state = statusStateForCode(status.code);
  if (["fixed", "refreshing", "refreshStarted", "fixing", "alreadyWorking", "cooldown"].includes(state)) {
    return false;
  }
  if (status.canFixCurrentPage === true) return true;
  return state === "unavailable";
}

function setFixVisibility(visible) {
  const action = document.getElementById("fix-action");
  const button = document.getElementById("fix-report");
  action.hidden = visible !== true;
  button.disabled = visible !== true;
  button.setAttribute("aria-disabled", String(button.disabled));
  if (visible === true) {
    button.setAttribute("aria-busy", "false");
    document.getElementById("fix-guidance").textContent = "Use this only if the Story Report stays blank.";
  }
}

function setStatusBusy(busy) {
  document.getElementById("status-card").setAttribute("aria-busy", String(busy === true));
}

function normalizeRuntimeResponse(response, requireAvailability) {
  if (!response || response.ok !== true || typeof response.code !== "string") return null;
  if (requireAvailability && typeof response.canFixCurrentPage !== "boolean") return null;
  if (response.canFixCurrentPage !== undefined && typeof response.canFixCurrentPage !== "boolean") return null;
  if (response.currentPageState !== undefined && typeof response.currentPageState !== "string") return null;
  return {
    code: response.code,
    canFixCurrentPage: response.canFixCurrentPage === true
  };
}

function scheduleStatusPoll(delay) {
  cancelScheduledStatusPoll();
  statusPollTimer = setTimeout(() => {
    statusPollTimer = null;
    void pollPopupStatus();
  }, delay);
}

function cancelScheduledStatusPoll() {
  if (statusPollTimer === null) return;
  clearTimeout(statusPollTimer);
  statusPollTimer = null;
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    let settled = false;
    let timeout = null;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      resolve(outcome);
    };
    timeout = setTimeout(
      () => finish({ kind: "timeout", response: null }),
      STATUS_REQUEST_TIMEOUT_MS
    );

    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          finish({ kind: "error", response: null });
          return;
        }
        finish({ kind: "response", response: response || null });
      });
    } catch {
      finish({ kind: "error", response: null });
    }
  });
}
