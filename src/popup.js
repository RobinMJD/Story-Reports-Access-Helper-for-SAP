const SAP_KB_URL = "https://userapps.support.sap.com/sap/support/knowledge/en/3039244";

const STATUS_COPY = Object.freeze({
  ready: ["Ready", "Open your Story Report as usual. The helper works automatically.", "success"],
  fixing: ["Preparing your report…", "Please wait a moment.", "active"],
  prepared: ["Report access ready", "You can continue with your Story Report.", "success"],
  failed: ["Try the report again", "If it still doesn’t open, view SAP’s help article.", "warning"]
});

const READY_CODES = new Set(["idle"]);
const FIXING_CODES = new Set(["continuation-in-progress"]);
const PREPARED_CODES = new Set(["replay-scheduled"]);

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("sap-help").addEventListener("click", openSapHelpArticle);

  const manifestVersion = chrome.runtime.getManifest?.().version;
  if (manifestVersion) document.getElementById("version").textContent = `v${manifestVersion}`;

  void loadPopupState();
});

async function loadPopupState() {
  const response = await sendRuntimeMessage({ type: "get-status" });
  renderStatus(response?.ok ? response.code : "error");
  if (response?.version) document.getElementById("version").textContent = `v${response.version}`;
}

function openSapHelpArticle() {
  chrome.tabs.create({ url: SAP_KB_URL });
}

function renderStatus(code) {
  let state = "failed";
  if (READY_CODES.has(code)) state = "ready";
  else if (FIXING_CODES.has(code)) state = "fixing";
  else if (PREPARED_CODES.has(code)) state = "prepared";

  const [title, detail, className] = STATUS_COPY[state];
  document.getElementById("status-title").textContent = title;
  document.getElementById("status-detail").textContent = detail;
  document.getElementById("status-dot").className = `status-dot ${className}`;
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
