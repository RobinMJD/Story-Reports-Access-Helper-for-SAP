const SAP_KB_URL = "https://userapps.support.sap.com/sap/support/knowledge/en/3039244";

const STATUS_COPY = Object.freeze({
  checking: ["Checking this page…", "Please wait a moment.", "checking"],
  idle: ["No fix applied yet", "Open a Story Report. Help starts automatically if it is needed.", "neutral"],
  unsupported: ["No fix applied yet", "Open SAP Report Center to get started.", "neutral"],
  waiting: ["SAP is still loading", "Wait for the page to finish, then reopen this window.", "active"],
  refreshing: ["Refreshing SAP…", "The page is being prepared. Please wait.", "active"],
  refreshStarted: ["Refresh started", "Open the Story Report again when SAP is ready.", "active"],
  fixing: ["Applying the fix…", "Please wait a few seconds.", "active"],
  alreadyWorking: ["Fix already running", "Please wait, then return to the report.", "active"],
  cooldown: ["Fix already started", "Wait a moment, then reopen this window if needed.", "active"],
  prepared: ["SAP page prepared", "Open the Story Report again. Help will continue automatically.", "active"],
  fixed: ["Fix applied", "The browser fix is active. Return to your report.", "success"],
  wrongPage: ["Open SAP Report Center", "Go to the report page, then try again.", "neutral"],
  manualFailed: ["Fix could not start", "Try the report again or open the SAP help article.", "warning"],
  failed: ["Fix not applied", "Use Fix this report, then open the Story again.", "warning"],
  unavailable: ["Status unavailable", "If the report is blank, you can still try the fix.", "warning"]
});

const FAILED_CODES = new Set([
  "automatic-fix-blocked",
  "resume-interrupted",
  "source-changed",
  "limit-reached",
  "incognito-not-supported",
  "error"
]);

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

  void loadPopupState();
});

async function loadPopupState() {
  const response = await sendRuntimeMessage({ type: "get-status" });
  const status = normalizeRuntimeResponse(response, true);
  setStatusBusy(false);
  if (!status) {
    renderStatus("status-unavailable", true);
    setFixVisibility(true);
    return;
  }

  renderStatus(status.code, status.canFixCurrentPage);
  setFixVisibility(shouldShowFix(status));
  if (typeof response.version === "string" && response.version) {
    document.getElementById("version").textContent = `v${response.version}`;
  }
}

async function forceFixCurrentReport() {
  const action = document.getElementById("fix-action");
  const button = document.getElementById("fix-report");
  if (action.hidden || button.disabled) return;

  button.disabled = true;
  button.setAttribute("aria-disabled", "true");
  button.setAttribute("aria-busy", "true");
  setStatusBusy(true);
  renderStatus("page-refreshing", false);

  const response = await sendRuntimeMessage({ type: "force-fix-current-tab" });
  const status = normalizeRuntimeResponse(response, false);
  button.setAttribute("aria-busy", "false");
  setStatusBusy(false);

  if (!status) {
    renderStatus("status-unavailable", true);
    setFixVisibility(true);
    return;
  }

  renderStatus(status.code, status.canFixCurrentPage);
  setFixVisibility(shouldShowFix(status));
}

function openSapHelpArticle() {
  chrome.tabs.create({ url: SAP_KB_URL });
}

function renderStatus(code, canFixCurrentPage) {
  const state = statusStateForCode(code);
  const [title, defaultDetail, className] = STATUS_COPY[state];
  const detail = state === "failed" && canFixCurrentPage === false
    ? "Wait a moment, then reopen this window to try the fix."
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

function shouldShowFix(status) {
  const state = statusStateForCode(status.code);
  if (state === "unavailable") return true;
  if (state === "idle" || state === "failed" || state === "manualFailed") {
    return status.canFixCurrentPage === true;
  }
  return false;
}

function setFixVisibility(visible) {
  const action = document.getElementById("fix-action");
  const button = document.getElementById("fix-report");
  action.hidden = visible !== true;
  button.disabled = visible !== true;
  button.setAttribute("aria-disabled", String(button.disabled));
  if (visible === true) {
    document.getElementById("fix-guidance").textContent = "Use this if the Story Report stays blank.";
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

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response || null);
      });
    } catch {
      resolve(null);
    }
  });
}
