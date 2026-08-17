import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const SAP_KB_URL = "https://userapps.support.sap.com/sap/support/knowledge/en/3039244";
const source = readFileSync(new URL("../src/popup.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../src/popup.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/popup.css", import.meta.url), "utf8");

test("popup is a clear, accessible, nontechnical status and help surface", () => {
  assert.equal((html.match(/class="status-card"/g) || []).length, 1);
  assert.equal((html.match(/<button\b/g) || []).length, 2);
  assert.match(html, /role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"[^>]*aria-busy="true"/i);
  assert.match(html, /id="status-dot"[^>]*class="status-dot checking"[^>]*aria-hidden="true"/);
  assert.match(html, /id="fix-action" hidden/);
  assert.match(html, /Fix this report/);
  assert.match(html, /aria-describedby="fix-guidance"/);
  assert.match(html, /aria-busy="false"/);
  assert.match(html, /Open SAP help article/);
  assert.match(html, /Automatic help · No report data sent/);
  assert.doesNotMatch(html, /\b(?:IAS|contentSettings|cookie|origin|replay|durable|pause|resume)\b/i);
  assert.doesNotMatch(html, /reliable mode|recovery card|workflow/i);
  assert.doesNotMatch(html, /<(?:input|select|textarea)\b/i);
  assert.doesNotMatch(source, /chrome\.permissions/);
  assert.doesNotMatch(source, /pause-automatic-fixing|resume-automatic-fixing/);
  assert.match(source, new RegExp(SAP_KB_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(css, /body\s*\{[^}]*width:\s*392px;/s);
  assert.match(css, /button\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important;/s);
  assert.match(css, /\.status-dot\.checking\s*\{[^}]*animation:/s);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /@media\s*\(prefers-color-scheme:\s*dark\)/);
  assert.doesNotMatch(css, /overflow-y:\s*(?:auto|scroll)/);
});

test("popup starts in an animated checking state with the manual action hidden", () => {
  const harness = createPopupHarness({ deferStatus: true });
  harness.open();

  assert.equal(harness.element("status-title").textContent, "Checking this page…");
  assert.equal(harness.element("status-detail").textContent, "Please wait a moment.");
  assert.equal(harness.element("status-dot").className, "status-dot checking");
  assert.equal(harness.element("status-card").attributes.get("aria-busy"), "true");
  assert.equal(harness.element("fix-action").hidden, true);
  assert.equal(harness.element("fix-report").disabled, true);
});

test("idle status says no fix has been applied and shows the manual action when applicable", async () => {
  const harness = createPopupHarness({ workflowCode: "idle", canFixCurrentPage: true });
  harness.open();
  await settle();

  assert.deepEqual(harness.messages, [{ type: "get-status" }]);
  assert.equal(harness.element("status-title").textContent, "No fix applied yet");
  assert.equal(
    harness.element("status-detail").textContent,
    "Open a Story Report. Help starts automatically if it is needed."
  );
  assert.equal(harness.element("status-dot").className, "status-dot neutral");
  assert.equal(harness.element("fix-action").hidden, false);
  assert.equal(harness.element("fix-report").disabled, false);
  assert.equal(harness.element("fix-guidance").textContent, "Use this if the Story Report stays blank.");
  assert.equal(harness.element("version").textContent, "v1.1.0");
  assert.equal(harness.element("status-card").attributes.get("aria-busy"), "false");
});

test("unsupported, loading, active, prepared, and fixed states hide the manual action", async () => {
  const cases = [
    ["unsupported-page", "No fix applied yet", "Open SAP Report Center to get started.", "status-dot neutral"],
    ["page-not-ready", "SAP is still loading", "Wait for the page to finish, then reopen this window.", "status-dot active"],
    ["page-refreshing", "Refreshing SAP…", "The page is being prepared. Please wait.", "status-dot active"],
    ["continuation-in-progress", "Applying the fix…", "Please wait a few seconds.", "status-dot active"],
    ["page-prepared", "SAP page prepared", "Open the Story Report again. Help will continue automatically.", "status-dot active"],
    ["replay-scheduled", "Fix applied", "The browser fix is active. Return to your report.", "status-dot success"]
  ];

  for (const [workflowCode, title, detail, className] of cases) {
    const harness = createPopupHarness({ workflowCode, canFixCurrentPage: false });
    harness.open();
    await settle();

    assert.equal(harness.element("status-title").textContent, title, workflowCode);
    assert.equal(harness.element("status-detail").textContent, detail, workflowCode);
    assert.equal(harness.element("status-dot").className, className, workflowCode);
    assert.equal(harness.element("fix-action").hidden, true, workflowCode);
    assert.doesNotMatch(
      `${title} ${detail}`,
      /\b(?:IAS|contentSettings|cookie|origin|replay|durable|pause|resume)\b/i,
      workflowCode
    );
  }
});

test("a known failed automatic result shows the manual action only when runtime allows it", async () => {
  for (const canFixCurrentPage of [true, false]) {
    const harness = createPopupHarness({ workflowCode: "automatic-fix-blocked", canFixCurrentPage });
    harness.open();
    await settle();

    assert.equal(harness.element("status-title").textContent, "Fix not applied");
    assert.equal(harness.element("fix-action").hidden, !canFixCurrentPage);
    assert.equal(
      harness.element("status-detail").textContent,
      canFixCurrentPage
        ? "Use Fix this report, then open the Story again."
        : "Wait a moment, then reopen this window to try the fix."
    );
  }
});

test("an unavailable or malformed availability check shows the strictly validated fallback action", async () => {
  for (const options of [
    { workflowCode: "check-unavailable", canFixCurrentPage: false, currentPageState: "unavailable" },
    { statusOk: false },
    { transportThrows: true },
    { canFixCurrentPage: "yes" }
  ]) {
    const harness = createPopupHarness(options);
    harness.open();
    await settle();

    assert.equal(harness.element("status-title").textContent, "Status unavailable");
    assert.equal(harness.element("status-detail").textContent, "If the report is blank, you can still try the fix.");
    assert.equal(harness.element("status-dot").className, "status-dot warning");
    assert.equal(harness.element("fix-action").hidden, false);
    assert.equal(harness.element("fix-report").disabled, false);
  }
});

test("manual action reports each accepted or refused runtime outcome exactly", async () => {
  const cases = [
    ["manual-refresh-started", "Refresh started", "Open the Story Report again when SAP is ready."],
    ["fix-in-progress", "Fix already running", "Please wait, then return to the report."],
    ["replay-scheduled", "Fix applied", "The browser fix is active. Return to your report."],
    ["fix-already-applied", "Fix applied", "The browser fix is active. Return to your report."],
    ["wrong-page", "Open SAP Report Center", "Go to the report page, then try again."],
    ["manual-fix-cooldown", "Fix already started", "Wait a moment, then reopen this window if needed."],
    ["manual-fix-failed", "Fix could not start", "Try the report again or open the SAP help article."]
  ];

  for (const [code, title, detail] of cases) {
    const harness = createPopupHarness({
      workflowCode: "idle",
      canFixCurrentPage: true,
      actionResponse: {
        ok: true,
        code,
        canFixCurrentPage: false,
        currentPageState: code === "wrong-page" ? "unsupported" : "ready"
      }
    });
    harness.open();
    await settle();

    await harness.click("fix-report");
    await settle();

    assert.deepEqual(harness.messages, [
      { type: "get-status" },
      { type: "force-fix-current-tab" }
    ]);
    assert.equal(harness.element("status-title").textContent, title, code);
    assert.equal(harness.element("status-detail").textContent, detail, code);
    assert.equal(harness.element("fix-action").hidden, true, code);
  }
});

test("an unavailable manual response restores the fallback action", async () => {
  const harness = createPopupHarness({ workflowCode: "idle", canFixCurrentPage: true, actionStatusOk: false });
  harness.open();
  await settle();

  await harness.click("fix-report");
  await settle();

  assert.equal(harness.element("status-title").textContent, "Status unavailable");
  assert.equal(harness.element("fix-action").hidden, false);
  assert.equal(harness.element("fix-report").disabled, false);
  assert.equal(harness.element("fix-report").attributes.get("aria-busy"), "false");
  assert.equal(harness.element("status-card").attributes.get("aria-busy"), "false");
});

test("manual action cannot run while it is hidden", async () => {
  const harness = createPopupHarness({ workflowCode: "unsupported-page", canFixCurrentPage: false });
  harness.open();
  await settle();

  await harness.click("fix-report");
  assert.deepEqual(harness.messages, [{ type: "get-status" }]);
});

test("secondary action opens the exact public SAP KBA in a new tab", async () => {
  const harness = createPopupHarness();
  harness.open();
  await settle();

  await harness.click("sap-help");
  assert.deepEqual(harness.createdTabs, [{ url: SAP_KB_URL }]);
  assert.equal(harness.messages.some((message) => Object.hasOwn(message, "url")), false);
});

function createPopupHarness(options = {}) {
  const listeners = new Map();
  const elements = new Map();
  const messages = [];
  const createdTabs = [];
  let domReadyListener;
  let deferredStatusCallback;

  class FakeElement {
    constructor(id) {
      this.id = id;
      this.textContent = "";
      this.className = "";
      this.disabled = false;
      this.hidden = false;
      this.attributes = new Map();
    }

    addEventListener(type, listener) {
      listeners.set(`${this.id}:${type}`, listener);
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }
  }

  const document = {
    addEventListener(type, listener) {
      if (type === "DOMContentLoaded") domReadyListener = listener;
    },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id));
      return elements.get(id);
    }
  };

  const chrome = {
    runtime: {
      lastError: undefined,
      getManifest() {
        return { version: "1.1.0" };
      },
      sendMessage(message, callback) {
        if (options.transportThrows) throw new Error("worker-unavailable");
        messages.push({ ...message });
        if (message.type === "force-fix-current-tab") {
          callback(options.actionStatusOk === false
            ? { ok: false, code: "error" }
            : options.actionResponse || {
                ok: true,
                code: "manual-refresh-started",
                canFixCurrentPage: false,
                currentPageState: "ready"
              });
          return;
        }
        if (options.deferStatus) {
          deferredStatusCallback = callback;
          return;
        }
        callback(makeStatusResponse(options));
      }
    },
    tabs: {
      create(details) {
        createdTabs.push({ ...details });
      }
    }
  };

  vm.runInNewContext(source, { chrome, document, Promise, Object, Set });

  return {
    messages,
    createdTabs,
    open() {
      assert.equal(typeof domReadyListener, "function");
      domReadyListener();
    },
    resolveStatus() {
      assert.equal(typeof deferredStatusCallback, "function");
      deferredStatusCallback(makeStatusResponse(options));
    },
    async click(id) {
      const element = document.getElementById(id);
      if (element.disabled || element.hidden || document.getElementById("fix-action").hidden && id === "fix-report") {
        return;
      }
      const listener = listeners.get(`${id}:click`);
      assert.equal(typeof listener, "function");
      return await listener({ isTrusted: true });
    },
    element(id) {
      return document.getElementById(id);
    }
  };
}

function makeStatusResponse(options) {
  return options.statusOk === false
    ? { ok: false, code: "error" }
    : {
        ok: true,
        code: options.workflowCode || "unsupported-page",
        canFixCurrentPage: options.canFixCurrentPage === undefined
          ? false
          : options.canFixCurrentPage,
        currentPageState: options.currentPageState || "unsupported",
        version: "1.1.0"
      };
}

async function settle() {
  for (let iteration = 0; iteration < 6; iteration += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
