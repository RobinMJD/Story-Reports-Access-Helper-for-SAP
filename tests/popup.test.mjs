import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const SAP_KB_URL = "https://userapps.support.sap.com/sap/support/knowledge/en/3039244";
const source = readFileSync(new URL("../src/popup.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../src/popup.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/popup.css", import.meta.url), "utf8");

test("popup is one compact, accessible, nontechnical status and help surface", () => {
  assert.equal((html.match(/class="status-card"/g) || []).length, 1);
  assert.equal((html.match(/<button\b/g) || []).length, 1);
  assert.match(html, /role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/i);
  assert.match(html, /Open SAP help article/);
  assert.match(html, /Works automatically · No report data sent/);
  assert.doesNotMatch(html, /\b(?:IAS|contentSettings|cookie|origin|replay|durable|pause|resume)\b/i);
  assert.doesNotMatch(html, /reliable mode|recovery card|workflow/i);
  assert.doesNotMatch(html, /<(?:input|select|textarea)\b/i);
  assert.doesNotMatch(source, /chrome\.permissions/);
  assert.doesNotMatch(source, /pause-automatic-fixing|resume-automatic-fixing/);
  assert.match(source, new RegExp(SAP_KB_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(css, /body\s*\{[^}]*width:\s*332px;/s);
  assert.match(css, /button\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(css, /@media\s*\(prefers-color-scheme:\s*dark\)/);
  assert.doesNotMatch(css, /overflow-y:\s*(?:auto|scroll)/);
});

test("idle status renders simple ready guidance", async () => {
  const harness = createPopupHarness({ workflowCode: "idle" });
  harness.open();
  await settle();

  assert.deepEqual(harness.messages, [{ type: "get-status" }]);
  assert.equal(harness.element("status-title").textContent, "Ready");
  assert.equal(
    harness.element("status-detail").textContent,
    "Open your Story Report as usual. The helper works automatically."
  );
  assert.equal(harness.element("status-dot").className, "status-dot success");
  assert.equal(harness.element("version").textContent, "v1.0.0");
});

test("runtime codes collapse into three plain user states", async () => {
  const cases = [
    ["continuation-in-progress", "Preparing your report…", "Please wait a moment.", "status-dot active"],
    ["replay-scheduled", "Report access ready", "You can continue with your Story Report.", "status-dot success"],
    [
      "automatic-fix-blocked",
      "Try the report again",
      "If it still doesn’t open, view SAP’s help article.",
      "status-dot warning"
    ]
  ];

  for (const [workflowCode, title, detail, className] of cases) {
    const harness = createPopupHarness({ workflowCode });
    harness.open();
    await settle();

    assert.equal(harness.element("status-title").textContent, title, workflowCode);
    assert.equal(harness.element("status-detail").textContent, detail, workflowCode);
    assert.equal(harness.element("status-dot").className, className, workflowCode);
    assert.doesNotMatch(
      `${title} ${detail}`,
      /\b(?:IAS|contentSettings|cookie|origin|replay|durable|pause|resume)\b/i,
      workflowCode
    );
  }
});

test("an unknown or unavailable state fails safely in plain language", async () => {
  for (const options of [
    { workflowCode: "unexpected-new-code" },
    { statusOk: false },
    { transportThrows: true }
  ]) {
    const harness = createPopupHarness(options);
    harness.open();
    await settle();

    assert.equal(harness.element("status-title").textContent, "Try the report again");
    assert.equal(harness.element("status-dot").className, "status-dot warning");
  }
});

test("the only action opens the exact public SAP KBA in a new tab", async () => {
  const harness = createPopupHarness();
  harness.open();
  await settle();

  harness.click("sap-help");
  assert.deepEqual(harness.createdTabs, [{ url: SAP_KB_URL }]);
  assert.equal(harness.messages.some((message) => Object.hasOwn(message, "url")), false);
});

function createPopupHarness(options = {}) {
  const listeners = new Map();
  const elements = new Map();
  const messages = [];
  const createdTabs = [];
  let domReadyListener;

  class FakeElement {
    constructor(id) {
      this.id = id;
      this.textContent = "";
      this.className = "";
    }

    addEventListener(type, listener) {
      listeners.set(`${this.id}:${type}`, listener);
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
        return { version: "1.0.0" };
      },
      sendMessage(message, callback) {
        if (options.transportThrows) throw new Error("worker-unavailable");
        messages.push({ ...message });
        callback(options.statusOk === false
          ? { ok: false, code: "error" }
          : {
              ok: true,
              code: options.workflowCode || "idle",
              version: "1.0.0"
            });
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
    click(id) {
      const listener = listeners.get(`${id}:click`);
      assert.equal(typeof listener, "function");
      return listener({ isTrusted: true });
    },
    element(id) {
      return document.getElementById(id);
    }
  };
}

async function settle() {
  for (let iteration = 0; iteration < 6; iteration += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
