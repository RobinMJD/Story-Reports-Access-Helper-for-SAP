import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const SAP_KB_URL = "https://userapps.support.sap.com/sap/support/knowledge/en/3039244";
const source = readFileSync(new URL("../src/popup.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../src/popup.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/popup.css", import.meta.url), "utf8");

test("popup remains a clear, accessible, nontechnical status and help surface", () => {
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
  assert.doesNotMatch(source, /\breopen\b/i);
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.match(source, /STATUS_REQUEST_TIMEOUT_MS = 1_000/);
  assert.match(source, /scheduleStatusPoll/);
  assert.match(source, /generation !== renderGeneration/);
  assert.match(source, new RegExp(SAP_KB_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(css, /body\s*\{[^}]*width:\s*392px;/s);
  assert.match(css, /button\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important;/s);
  assert.match(css, /\.status-dot\.checking\s*\{[^}]*animation:/s);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /@media\s*\(prefers-color-scheme:\s*dark\)/);
  assert.doesNotMatch(css, /overflow-y:\s*(?:auto|scroll)/);
});

test("popup renders Checking immediately and keeps SAP help responsive while status is pending", async () => {
  const harness = createPopupHarness({ statusSequence: ["defer"] });
  harness.open();

  assert.deepEqual(harness.messages, [{ type: "get-status" }]);
  assert.equal(harness.element("status-title").textContent, "Checking this report…");
  assert.equal(harness.element("status-detail").textContent, "This status updates automatically.");
  assert.equal(harness.element("status-dot").className, "status-dot checking");
  assert.equal(harness.element("status-card").attributes.get("aria-busy"), "true");
  assert.equal(harness.element("fix-action").hidden, true);
  assert.equal(harness.element("fix-report").disabled, true);

  await harness.click("sap-help");
  assert.deepEqual(harness.createdTabs, [{ url: SAP_KB_URL }]);
});

test("idle status is reassuring and exposes the manual action only as a fallback", async () => {
  const harness = createPopupHarness({
    statusSequence: [statusResponse("idle", true, "ready")]
  });
  harness.open();
  await settle();

  assert.equal(harness.element("status-title").textContent, "Extension ready");
  assert.equal(
    harness.element("status-detail").textContent,
    "Automatic help is active. Use the button only if the report is blank."
  );
  assert.equal(harness.element("status-dot").className, "status-dot neutral");
  assert.equal(harness.element("fix-action").hidden, false);
  assert.equal(harness.element("fix-report").disabled, false);
  assert.equal(harness.element("fix-guidance").textContent, "Use this only if the Story Report stays blank.");
  assert.equal(harness.element("version").textContent, "v1.1.1");
  assert.equal(harness.element("status-card").attributes.get("aria-busy"), "false");
});

test("page-not-ready remains dynamic and shows Fix whenever runtime says it is applicable", async () => {
  for (const canFixCurrentPage of [true, false]) {
    const harness = createPopupHarness({
      statusSequence: [statusResponse("page-not-ready", canFixCurrentPage, "loading")]
    });
    harness.open();
    await settle();

    assert.equal(harness.element("status-title").textContent, "Checking SAP…");
    assert.equal(harness.element("status-detail").textContent, "This status updates automatically.");
    assert.equal(harness.element("status-dot").className, "status-dot checking");
    assert.equal(harness.element("status-card").attributes.get("aria-busy"), "true");
    assert.equal(harness.element("fix-action").hidden, !canFixCurrentPage);
    assert.equal(harness.element("fix-report").disabled, !canFixCurrentPage);
  }
});

test("one open popup follows loading, preparation, and applied states without reopening", async () => {
  const harness = createPopupHarness({
    statusSequence: [
      statusResponse("page-not-ready", false, "loading"),
      statusResponse("page-refreshing", false, "loading"),
      statusResponse("replay-scheduled", false, "loading")
    ]
  });
  harness.open();
  await settle();
  assert.equal(harness.element("status-title").textContent, "Checking SAP…");

  await harness.advance(500);
  assert.equal(harness.element("status-title").textContent, "Preparing this report…");

  await harness.advance(500);
  assert.equal(harness.element("status-title").textContent, "Access fix applied");
  assert.equal(harness.element("status-detail").textContent, "Browser access was prepared for this SAP site.");
  assert.equal(harness.element("status-dot").className, "status-dot success");
  assert.equal(harness.element("fix-action").hidden, true);
  assert.deepEqual(harness.messages, [
    { type: "get-status" },
    { type: "get-status" },
    { type: "get-status" }
  ]);
});

test("repeated bounded timeouts reveal the safe fallback and a later poll recovers", async () => {
  const harness = createPopupHarness({
    statusSequence: [
      "timeout",
      "timeout",
      statusResponse("replay-scheduled", false, "loading")
    ]
  });
  harness.open();

  await harness.advance(1_000);
  assert.equal(harness.element("status-title").textContent, "Checking this report…");
  assert.equal(harness.messages.length, 1);

  await harness.advance(250);
  assert.equal(harness.messages.length, 2);
  await harness.advance(1_000);
  assert.equal(harness.element("status-title").textContent, "Couldn’t confirm status");
  assert.equal(harness.element("fix-action").hidden, false);
  assert.equal(harness.element("fix-report").disabled, false);
  assert.equal(harness.element("status-card").attributes.get("aria-busy"), "true");

  await harness.advance(250);
  assert.equal(harness.element("status-title").textContent, "Access fix applied");
  assert.equal(harness.element("fix-action").hidden, true);
  assert.equal(harness.messages.length, 3);
});

test("a late status response cannot overwrite a newer manual result", async () => {
  const harness = createPopupHarness({
    statusSequence: [statusResponse("idle", true, "ready"), "defer"],
    actionResponse: statusResponse("fix-already-applied", false, "ready")
  });
  harness.open();
  await settle();

  await harness.advance(500);
  assert.equal(harness.deferredStatusCount(), 1);
  await harness.click("fix-report");
  await settle();
  assert.equal(harness.element("status-title").textContent, "Access fix applied");

  harness.resolveDeferredStatus(statusResponse("idle", true, "ready"));
  await settle();
  assert.equal(harness.element("status-title").textContent, "Access fix applied");
  assert.equal(harness.element("fix-action").hidden, true);
});

test("manual action gives immediate feedback and then follows progress to completion", async () => {
  const harness = createPopupHarness({
    statusSequence: [
      statusResponse("idle", true, "ready"),
      statusResponse("page-refreshing", false, "loading"),
      statusResponse("replay-scheduled", false, "loading")
    ],
    actionResponse: "defer"
  });
  harness.open();
  await settle();

  const actionPromise = harness.click("fix-report");
  assert.equal(harness.element("status-title").textContent, "Preparing this report…");
  assert.equal(harness.element("status-detail").textContent, "This status updates automatically.");
  assert.equal(harness.element("fix-report").disabled, true);
  assert.equal(harness.element("fix-report").attributes.get("aria-busy"), "true");

  await harness.click("sap-help");
  assert.deepEqual(harness.createdTabs, [{ url: SAP_KB_URL }]);

  harness.resolveDeferredAction(statusResponse("manual-refresh-started", false, "ready"));
  await actionPromise;
  await settle();
  assert.equal(harness.element("status-title").textContent, "Preparing this report…");

  await harness.advance(250);
  assert.equal(harness.element("status-title").textContent, "Preparing this report…");
  await harness.advance(500);
  assert.equal(harness.element("status-title").textContent, "Access fix applied");
  assert.deepEqual(harness.messages, [
    { type: "get-status" },
    { type: "force-fix-current-tab" },
    { type: "get-status" },
    { type: "get-status" }
  ]);
});

test("a timed-out manual action becomes usable and still recovers from later status", async () => {
  const harness = createPopupHarness({
    statusSequence: [
      statusResponse("idle", true, "ready"),
      statusResponse("replay-scheduled", false, "loading")
    ],
    actionResponse: "timeout"
  });
  harness.open();
  await settle();

  const actionPromise = harness.click("fix-report");
  await harness.advance(1_000);
  await actionPromise;
  assert.equal(harness.element("status-title").textContent, "Couldn’t confirm status");
  assert.equal(harness.element("fix-action").hidden, false);
  assert.equal(harness.element("fix-report").disabled, false);

  await harness.advance(250);
  assert.equal(harness.element("status-title").textContent, "Access fix applied");
  assert.equal(harness.element("fix-action").hidden, true);
});

test("known states gate the manual action without exposing internal terminology", async () => {
  const cases = [
    ["unsupported-page", false, "Extension ready", false],
    ["page-refreshing", false, "Preparing this report…", false],
    ["continuation-in-progress", false, "Applying access fix…", false],
    ["page-prepared", false, "Automatic help is ready", false],
    ["replay-scheduled", false, "Access fix applied", false],
    ["automatic-fix-blocked", true, "Access fix not applied", true],
    ["automatic-fix-blocked", false, "Access fix not applied", false],
    ["check-unavailable", false, "Couldn’t confirm status", true]
  ];

  for (const [code, canFixCurrentPage, title, showsFix] of cases) {
    const harness = createPopupHarness({
      statusSequence: [statusResponse(code, canFixCurrentPage)]
    });
    harness.open();
    await settle();

    assert.equal(harness.element("status-title").textContent, title, code);
    assert.equal(harness.element("fix-action").hidden, !showsFix, code);
    assert.doesNotMatch(
      `${harness.element("status-title").textContent} ${harness.element("status-detail").textContent}`,
      /\b(?:IAS|contentSettings|cookie|origin|replay|durable|pause|resume|reopen)\b/i,
      code
    );
  }
});

test("manual action reports refused outcomes and hidden actions cannot execute", async () => {
  const cases = [
    ["wrong-page", "Open SAP Report Center"],
    ["manual-fix-cooldown", "Access fix is already starting"],
    ["manual-fix-failed", "Access fix could not start"],
    ["fix-in-progress", "Access fix is already running"]
  ];

  for (const [code, title] of cases) {
    const harness = createPopupHarness({
      statusSequence: [statusResponse("idle", true, "ready")],
      actionResponse: statusResponse(code, false, code === "wrong-page" ? "unsupported" : "ready")
    });
    harness.open();
    await settle();
    await harness.click("fix-report");
    await settle();
    assert.equal(harness.element("status-title").textContent, title, code);
  }

  const hidden = createPopupHarness({
    statusSequence: [statusResponse("unsupported-page", false, "unsupported")]
  });
  hidden.open();
  await settle();
  await hidden.click("fix-report");
  assert.deepEqual(hidden.messages, [{ type: "get-status" }]);
});

function createPopupHarness(options = {}) {
  const listeners = new Map();
  const elements = new Map();
  const messages = [];
  const createdTabs = [];
  const clock = new FakeClock();
  const statusSequence = [...(options.statusSequence || [statusResponse("unsupported-page", false, "unsupported")])];
  const deferredStatusCallbacks = [];
  const deferredActionCallbacks = [];
  let domReadyListener;

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
        return { version: "1.1.1" };
      },
      sendMessage(message, callback) {
        messages.push({ ...message });
        if (message.type === "force-fix-current-tab") {
          dispatchFakeResponse(
            options.actionResponse || statusResponse("manual-refresh-started", false, "ready"),
            callback,
            deferredActionCallbacks
          );
          return;
        }
        const response = statusSequence.length
          ? statusSequence.shift()
          : options.defaultStatusResponse || statusResponse("replay-scheduled", false, "ready");
        dispatchFakeResponse(response, callback, deferredStatusCallbacks);
      }
    },
    tabs: {
      create(details) {
        createdTabs.push({ ...details });
      }
    }
  };

  vm.runInNewContext(source, {
    chrome,
    document,
    Promise,
    Object,
    Set,
    setTimeout: clock.setTimeout.bind(clock),
    clearTimeout: clock.clearTimeout.bind(clock)
  });

  return {
    messages,
    createdTabs,
    open() {
      assert.equal(typeof domReadyListener, "function");
      domReadyListener();
    },
    async advance(milliseconds) {
      await clock.advance(milliseconds);
    },
    deferredStatusCount() {
      return deferredStatusCallbacks.length;
    },
    resolveDeferredStatus(response) {
      const callback = deferredStatusCallbacks.shift();
      assert.equal(typeof callback, "function");
      callback(response);
    },
    resolveDeferredAction(response) {
      const callback = deferredActionCallbacks.shift();
      assert.equal(typeof callback, "function");
      callback(response);
    },
    async click(id) {
      const element = document.getElementById(id);
      if (
        element.disabled ||
        element.hidden ||
        (id === "fix-report" && document.getElementById("fix-action").hidden)
      ) return;
      const listener = listeners.get(`${id}:click`);
      assert.equal(typeof listener, "function");
      return await listener({ isTrusted: true });
    },
    element(id) {
      return document.getElementById(id);
    }
  };
}

function dispatchFakeResponse(response, callback, deferredCallbacks) {
  if (response === "timeout") return;
  if (response === "defer") {
    deferredCallbacks.push(callback);
    return;
  }
  callback(response);
}

function statusResponse(code, canFixCurrentPage, currentPageState = "ready") {
  return {
    ok: true,
    code,
    canFixCurrentPage,
    currentPageState,
    version: "1.1.1"
  };
}

class FakeClock {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.tasks = new Map();
  }

  setTimeout(callback, delay = 0) {
    const id = this.nextId;
    this.nextId += 1;
    this.tasks.set(id, {
      callback,
      dueAt: this.now + Math.max(0, Number(delay) || 0),
      id
    });
    return id;
  }

  clearTimeout(id) {
    this.tasks.delete(id);
  }

  async advance(milliseconds) {
    const target = this.now + milliseconds;
    let iterations = 0;
    while (true) {
      const next = [...this.tasks.values()]
        .filter((task) => task.dueAt <= target)
        .sort((left, right) => left.dueAt - right.dueAt || left.id - right.id)[0];
      if (!next) break;
      if (iterations > 1_000) throw new Error("fake timer runaway");
      iterations += 1;
      this.now = next.dueAt;
      this.tasks.delete(next.id);
      next.callback();
      await settle();
    }
    this.now = target;
    await settle();
  }
}

async function settle() {
  for (let iteration = 0; iteration < 6; iteration += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
