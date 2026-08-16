import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/ias-content.js", import.meta.url), "utf8");
const ATTEMPT_ID = "123e4567-e89b-42d3-a456-426614174000";
const SF_ORIGIN = "https://sampletenant.successfactors.eu";
const IAS_ORIGIN = "https://tenant.accounts.ondemand.com";

test("a top-level IAS interaction page is completely untouched", () => {
  const result = runTopLevelIasContext();
  assert.equal(result.listenerRegistrations, 0);
  assert.equal(result.observerConstructions, 0);
  assert.deepEqual(result.messages, []);
});

test("an exact nested IAS interstitial reports one canonical SuccessFactors origin", async () => {
  const accepted = runInterstitialContext(SF_ORIGIN);
  assert.deepEqual(clone(accepted.messages), [
    { type: "interstitial-detected", sourceOrigin: SF_ORIGIN }
  ]);
  await accepted.runTimersThrough(10_000);
  assert.equal(accepted.messages.filter((message) => message.type === "interstitial-detected").length, 1);

  for (const ancestorOrigin of [
    "https://successfactors.eu.evil.example",
    "https://successfactors.eu",
    "http://sampletenant.successfactors.eu",
    "https://sampletenant.successfactors.eu:8443",
    "https://accounts.sapcloud.cn"
  ]) {
    const rejected = runInterstitialContext(ancestorOrigin);
    assert.deepEqual(clone(rejected.messages), [], ancestorOrigin);
  }
});

test("all supported IAS families are accepted but apexes and lookalikes are rejected", () => {
  for (const hostname of [
    "tenant.accounts.ondemand.com",
    "tenant.accounts400.ondemand.com",
    "tenant.accounts.cloud.sap",
    "tenant.accounts400.cloud.sap",
    "tenant.accounts.sapcloud.cn"
  ]) {
    assert.equal(runInterstitialContext("https://customer.sapsf.cn", { iasHostname: hostname }).messages[0]?.type,
      "interstitial-detected", hostname);
  }
  for (const hostname of [
    "accounts.ondemand.com",
    "accounts.sapcloud.cn",
    "tenant.accounts.ondemand.com.evil.example"
  ]) {
    assert.deepEqual(runInterstitialContext(SF_ORIGIN, { iasHostname: hostname }).messages, [], hostname);
  }
});

test("the documented SuccessFactors China host family is accepted", () => {
  assert.equal(
    runInterstitialContext("https://sampletenant.successfactors.cn").messages[0]?.type,
    "interstitial-detected"
  );
});

test("only the exact owned replay structure is detected", () => {
  for (const options of [
    { actionPath: "/different/path" },
    { breakContainment: true },
    { duplicateId: "reloadPageForm" },
    { disconnectedForm: true },
    { formTarget: "_blank" },
    { formEnctype: "multipart/form-data" },
    { actionQuery: "?unexpected=1" },
    { extraReplayField: true },
    { changedFieldType: true }
  ]) {
    const result = runInterstitialContext(SF_ORIGIN, options);
    assert.deepEqual(clone(result.messages), [], JSON.stringify(options));
  }
});

test("a hidden exact structure is reported once by the bounded read-only fallback", async () => {
  for (const options of [
    { grantDisplay: "none", hasAccessSequence: [false] },
    { grantDisplay: "none", hasAccessError: true },
    { grantDisplay: "none", hasStorageAccessUnsupported: true }
  ]) {
    const result = runInterstitialContext(SF_ORIGIN, options);
    assert.deepEqual(result.messages, []);
    await result.runTimersThrough(2_499);
    assert.deepEqual(result.messages, []);
    await result.runTimersThrough(2_500);
    assert.deepEqual(clone(result.messages), [
      { type: "interstitial-detected", sourceOrigin: SF_ORIGIN }
    ]);
  }

  const alreadyActive = runInterstitialContext(SF_ORIGIN, {
    grantDisplay: "none",
    hasAccessSequence: [true]
  });
  await alreadyActive.runTimersThrough(2_500);
  assert.deepEqual(alreadyActive.messages, []);
  assert.equal(alreadyActive.counters.hasAccessChecks, 1);
});

test("direct continuation requires active storage access and never invokes an activation API", async () => {
  for (const options of [
    { hasAccessSequence: [false] },
    { hasAccessError: true },
    { hasStorageAccessUnsupported: true }
  ]) {
    const result = runInterstitialContext(SF_ORIGIN, options);
    const response = await result.send({ type: "resume-with-cookie-exception", resumeAttemptId: ATTEMPT_ID });
    assert.deepEqual(response, {
      ready: true,
      replaySubmitted: false,
      code: "cookie-exception-not-active",
      iasOrigin: IAS_ORIGIN,
      sourceOrigin: SF_ORIGIN
    });
    assert.equal(result.counters.nativeSubmits, 0);
    assert.equal(result.messages.some((message) => message.type === "replay-schedule-ready"), false);
  }
  assert.doesNotMatch(source, /requestStorageAccess\s*\(/);
});

test("the durable commit ACK precedes outer acknowledgement and one native replay", async () => {
  const result = runInterstitialContext(SF_ORIGIN, {
    hasAccessSequence: [true],
    deferZeroDelayTimers: true,
    teardownMessageChannelsOnSubmit: true
  });
  const response = await result.send({ type: "resume-with-cookie-exception", resumeAttemptId: ATTEMPT_ID });

  assert.deepEqual(response, {
    ready: true,
    replayScheduled: true,
    code: "replay-scheduled",
    iasOrigin: IAS_ORIGIN,
    sourceOrigin: SF_ORIGIN
  });
  assert.equal(result.counters.nativeSubmits, 0);
  assert.deepEqual(result.events, [
    "replay-task-registered",
    "commit-ready",
    "commit-ack",
    "outer-response"
  ]);
  assert.deepEqual(
    clone(result.messages.filter((message) => message.type === "replay-schedule-ready")),
    [{ type: "replay-schedule-ready", resumeAttemptId: ATTEMPT_ID }]
  );

  await result.runTimersThrough(0);
  assert.equal(result.counters.nativeSubmits, 1);
  assert.equal(result.counters.navigationTeardowns, 1);
  assert.equal(result.counters.droppedResponseChannels, 0);
  assert.equal(result.events.at(-1), "native-submit");

  const duplicate = await result.send({ type: "resume-with-cookie-exception", resumeAttemptId: ATTEMPT_ID });
  assert.equal(duplicate.code, "resume-already-attempted");
  assert.equal(result.counters.nativeSubmits, 1);
});

test("a missing, malformed, or mismatched durable ACK permits zero submissions", async () => {
  for (const options of [
    { commitAck: false },
    { commitLastError: true },
    { commitAckOverride: { ok: true, code: "replay-schedule-committed", resumeAttemptId: ATTEMPT_ID, extra: true } },
    { commitAckOverride: { ok: true, code: "replay-schedule-committed", resumeAttemptId: "223e4567-e89b-42d3-a456-426614174000" } },
    { commitAckOverride: { ok: true, code: "wrong", resumeAttemptId: ATTEMPT_ID } }
  ]) {
    const result = runInterstitialContext(SF_ORIGIN, { hasAccessSequence: [true], ...options });
    const response = await result.send({ type: "resume-with-cookie-exception", resumeAttemptId: ATTEMPT_ID });
    assert.equal(response.code, "resume-interrupted", JSON.stringify(options));
    assert.equal(response.replaySubmitted, false, JSON.stringify(options));
    await result.runTimersThrough(0);
    assert.equal(result.counters.nativeSubmits, 0, JSON.stringify(options));
  }
});

test("the exact document, ancestor, form, and schema are revalidated before commit and submit", async () => {
  for (const mutateAfterFirstAccess of [
    ({ form }) => { form.actionPath = "/different/path"; },
    ({ location }) => { location.ancestorOrigins[0] = "https://successfactors.eu.evil.example"; },
    ({ controls }) => { controls[0].fieldType = "text"; }
  ]) {
    const result = runInterstitialContext(SF_ORIGIN, {
      hasAccessSequence: [true],
      mutateAfterFirstAccess
    });
    const response = await result.send({ type: "resume-with-cookie-exception", resumeAttemptId: ATTEMPT_ID });
    assert.equal(response.code, "source-changed");
    assert.equal(response.ready, false);
    assert.equal(result.counters.nativeSubmits, 0);
    assert.equal(result.messages.some((message) => message.type === "replay-schedule-ready"), false);
  }

  const changedAfterCommit = runInterstitialContext(SF_ORIGIN, {
    hasAccessSequence: [true],
    deferZeroDelayTimers: true,
    mutateBeforeCommitAck: ({ form }) => { form.actionPath = "/different/path"; }
  });
  assert.equal(
    (await changedAfterCommit.send({ type: "resume-with-cookie-exception", resumeAttemptId: ATTEMPT_ID })).code,
    "replay-scheduled"
  );
  await changedAfterCommit.runTimersThrough(0);
  assert.equal(changedAfterCommit.counters.nativeSubmits, 0);
});

test("messages are exact, extension-bound, UUID-bound, and at most one continuation can commit", async () => {
  for (const message of [
    { type: "resume-with-cookie-exception" },
    { type: "resume-with-cookie-exception", resumeAttemptId: "not-a-uuid" },
    { type: "resume-with-cookie-exception", resumeAttemptId: ATTEMPT_ID.toUpperCase() },
    { type: "resume-with-cookie-exception", resumeAttemptId: ATTEMPT_ID, extra: true }
  ]) {
    const result = runInterstitialContext(SF_ORIGIN, { hasAccessSequence: [true] });
    assert.equal(await result.send(message, "test-extension", false), undefined, JSON.stringify(message));
    assert.equal(result.counters.nativeSubmits, 0);
  }

  const wrongSender = runInterstitialContext(SF_ORIGIN, { hasAccessSequence: [true] });
  assert.equal(
    await wrongSender.send(
      { type: "resume-with-cookie-exception", resumeAttemptId: ATTEMPT_ID },
      "different-extension"
    ),
    undefined
  );

  const concurrent = runInterstitialContext(SF_ORIGIN, { hasAccessSequence: [true, true] });
  const responses = await Promise.all([
    concurrent.send({ type: "resume-with-cookie-exception", resumeAttemptId: ATTEMPT_ID }),
    concurrent.send({
      type: "resume-with-cookie-exception",
      resumeAttemptId: "223e4567-e89b-42d3-a456-426614174000"
    })
  ]);
  assert.deepEqual(responses.map((response) => response.code).sort(), [
    "replay-scheduled",
    "resume-already-attempted"
  ]);
  assert.equal(concurrent.counters.nativeSubmits, 1);
  assert.equal(concurrent.messages.filter((message) => message.type === "replay-schedule-ready").length, 1);
});

function runTopLevelIasContext() {
  let listenerRegistrations = 0;
  let observerConstructions = 0;
  const messages = [];
  class MutationObserver {
    constructor() { observerConstructions += 1; }
  }
  const windowObject = {
    location: makeLocation("tenant.accounts.ondemand.com", "/ui/storageAccess/interact"),
    setTimeout() { throw new Error("top-level page must not schedule work"); }
  };
  windowObject.top = windowObject;
  vm.runInNewContext(source, {
    window: windowObject,
    document: {},
    MutationObserver,
    URL,
    chrome: {
      runtime: {
        id: "test-extension",
        onMessage: { addListener() { listenerRegistrations += 1; } },
        sendMessage(message) { messages.push(message); }
      }
    }
  });
  return { listenerRegistrations, observerConstructions, messages };
}

function runInterstitialContext(ancestorOrigin, options = {}) {
  const iasHostname = options.iasHostname || "tenant.accounts.ondemand.com";
  const locationPath = options.locationPath || "/saml2/idp/sso/tenant";
  const actionPath = options.actionPath || locationPath;
  const expectedFields = ["utf8", "authenticity_token", "method", "idpSSOEndpoint", "SAMLRequest", "RelayState"];
  const counters = {
    hasAccessChecks: 0,
    nativeSubmits: 0,
    navigationTeardowns: 0,
    droppedResponseChannels: 0
  };
  const events = [];
  const messages = [];
  const scheduledTimers = [];
  const responseChannels = new Set();
  let nextTimerId = 1;
  let runtimeListener = null;

  class HTMLElement {
    constructor() {
      this.hidden = false;
      this.isConnected = true;
    }
  }
  class HTMLButtonElement extends HTMLElement {}
  class HTMLFormElement extends HTMLElement {
    constructor() {
      super();
      this.actionPath = actionPath;
      this.elements = [];
    }
    getAttribute(name) {
      if (name === "method") return "post";
      if (name === "action") return `https://${iasHostname}${this.actionPath}${options.actionQuery || ""}`;
      if (name === "target") return options.formTarget || null;
      if (name === "enctype") return options.formEnctype || null;
      return null;
    }
    submit() {
      counters.nativeSubmits += 1;
      events.push("native-submit");
      if (options.teardownMessageChannelsOnSubmit) {
        counters.navigationTeardowns += 1;
        for (const channel of [...responseChannels]) channel.drop();
      }
    }
  }
  class HTMLInputElement extends HTMLElement {
    constructor(fieldName) {
      super();
      this.tagName = "INPUT";
      this.fieldName = fieldName;
      this.fieldType = "hidden";
      this.disabled = false;
      this.form = null;
    }
    getAttribute(name) {
      if (name === "name") return this.fieldName;
      if (name === "type") return this.fieldType;
      return null;
    }
    get value() {
      throw new Error("field values must never be read");
    }
  }
  class MutationObserver {
    observe() {}
    disconnect() {}
  }

  const location = makeLocation(iasHostname, locationPath, [ancestorOrigin]);
  const elements = {
    grantAccessDiv: new HTMLElement(),
    requestStorageAccessConfirm: new HTMLButtonElement(),
    storageAccessError: new HTMLElement(),
    reloadPageForm: new HTMLFormElement()
  };
  const controls = expectedFields.map((name) => new HTMLInputElement(name));
  if (options.changedFieldType) controls[0].fieldType = "text";
  if (options.extraReplayField) controls.push(new HTMLInputElement("unexpected"));
  elements.reloadPageForm.elements = controls;
  for (const control of controls) control.form = elements.reloadPageForm;
  if (options.disconnectedForm) elements.reloadPageForm.isConnected = false;
  elements.grantAccessDiv.contains = (element) =>
    !options.breakContainment &&
    [elements.requestStorageAccessConfirm, elements.storageAccessError, elements.reloadPageForm].includes(element);

  const documentObject = {
    documentElement: {},
    getElementById: (id) => elements[id] || null,
    querySelectorAll(selector) {
      if (!selector.startsWith("#")) return [];
      const id = selector.slice(1);
      const element = elements[id];
      if (!element) return [];
      return options.duplicateId === id ? [element, new HTMLElement()] : [element];
    }
  };
  for (const element of [...Object.values(elements), ...controls]) element.ownerDocument = documentObject;

  if (!options.hasStorageAccessUnsupported) {
    const sequence = options.hasAccessSequence || [true];
    documentObject.hasStorageAccess = async () => {
      counters.hasAccessChecks += 1;
      const result = sequence[Math.min(counters.hasAccessChecks - 1, sequence.length - 1)];
      if (counters.hasAccessChecks === 1) {
        options.mutateAfterFirstAccess?.({
          form: elements.reloadPageForm,
          controls,
          elements,
          location
        });
      }
      if (options.hasAccessError) throw new Error("has-storage-access-error");
      return result;
    };
  }

  const windowObject = {
    location,
    top: {},
    setTimeout(callback, delay) {
      const timer = { callback, delay, id: nextTimerId++ };
      if (delay === 0) events.push("replay-task-registered");
      if ((delay === 0 && options.deferZeroDelayTimers) || delay > 600) {
        scheduledTimers.push(timer);
      } else {
        callback();
      }
      return timer.id;
    },
    getComputedStyle(element) {
      return {
        display: element === elements.grantAccessDiv ? options.grantDisplay || "block" : "block",
        visibility: "visible",
        opacity: "1"
      };
    }
  };

  const context = {
    window: windowObject,
    document: documentObject,
    MutationObserver,
    HTMLElement,
    HTMLButtonElement,
    HTMLFormElement,
    HTMLInputElement,
    URL,
    chrome: {
      runtime: {
        id: "test-extension",
        lastError: undefined,
        onMessage: { addListener(listener) { runtimeListener = listener; } },
        sendMessage(message, callback) {
          messages.push(clone(message));
          if (message.type !== "replay-schedule-ready") {
            callback?.({ ok: true });
            return;
          }
          events.push("commit-ready");
          options.mutateBeforeCommitAck?.({
            form: elements.reloadPageForm,
            controls,
            elements,
            location
          });
          if (options.commitLastError) {
            context.chrome.runtime.lastError = { message: "channel-lost" };
            callback?.(undefined);
            context.chrome.runtime.lastError = undefined;
            return;
          }
          if (options.commitAck === false) {
            callback?.(undefined);
            return;
          }
          events.push("commit-ack");
          callback?.(options.commitAckOverride || {
            ok: true,
            code: "replay-schedule-committed",
            resumeAttemptId: message.resumeAttemptId
          });
        }
      }
    }
  };

  vm.runInNewContext(source, context);
  return {
    counters,
    events,
    messages,
    elements,
    controls,
    location,
    async runTimersThrough(maxDelay) {
      const due = scheduledTimers
        .filter((timer) => timer.delay <= maxDelay)
        .sort((left, right) => left.delay - right.delay || left.id - right.id);
      for (const timer of due) {
        const index = scheduledTimers.indexOf(timer);
        if (index >= 0) scheduledTimers.splice(index, 1);
        await timer.callback();
        await Promise.resolve();
      }
    },
    send(message, senderId = "test-extension") {
      return new Promise((resolve) => {
        let settled = false;
        let responded = false;
        const channel = {
          drop() {
            if (settled) return;
            settled = true;
            responseChannels.delete(channel);
            counters.droppedResponseChannels += 1;
            resolve(undefined);
          }
        };
        responseChannels.add(channel);
        const keepOpen = runtimeListener?.(clone(message), { id: senderId }, (response) => {
          if (settled) return;
          responded = true;
          settled = true;
          responseChannels.delete(channel);
          events.push("outer-response");
          resolve(clone(response));
        });
        if (keepOpen !== true && !responded) {
          settled = true;
          responseChannels.delete(channel);
          resolve(undefined);
        }
      }).then(async (response) => {
        await Promise.resolve();
        return response;
      });
    }
  };
}

function makeLocation(hostname, pathname, ancestorOrigins = []) {
  return {
    protocol: "https:",
    hostname,
    username: "",
    password: "",
    port: "",
    pathname,
    search: "",
    hash: "",
    origin: `https://${hostname}`,
    href: `https://${hostname}${pathname}`,
    ancestorOrigins
  };
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
