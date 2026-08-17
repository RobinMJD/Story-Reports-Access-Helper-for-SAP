import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/sf-activation.js", import.meta.url), "utf8");

test("the activation sentinel is top-frame-only and globally idempotent", () => {
  const top = runSentinel({ topFrame: true, executions: 2 });
  assert.equal(top.listeners.length, 1);
  assert.deepEqual(top.readyMessages, [{
    type: "sf-activation-ready",
    build: "1.1.1",
    protocol: 1
  }]);

  const nested = runSentinel({ topFrame: false, executions: 2 });
  assert.equal(nested.listeners.length, 0);
  assert.deepEqual(nested.readyMessages, []);
});

test("the sentinel answers only the same extension's exact current probe", () => {
  const { send } = runSentinel({ topFrame: true });
  assert.deepEqual(send({
    type: "sf-activation-probe",
    build: "1.1.1",
    protocol: 1
  }), {
    type: "sf-activation-current",
    build: "1.1.1",
    protocol: 1
  });

  for (const [message, senderId] of [
    [{ type: "sf-activation-probe", build: "0.3.0", protocol: 1 }, "extension-id"],
    [{ type: "sf-activation-probe", build: "1.1.1", protocol: 2 }, "extension-id"],
    [{ type: "sf-activation-probe", build: "1.1.1", protocol: 1, extra: true }, "extension-id"],
    [{ type: "sf-activation-probe", protocol: 1 }, "extension-id"],
    [{ type: "sf-activation-probe", build: "1.1.1", protocol: 1 }, "different-extension"],
    [null, "extension-id"]
  ]) {
    assert.equal(send(message, senderId), undefined, JSON.stringify(message));
  }
});

test("the sentinel is DOM-, storage-, and network-free", () => {
  assert.match(source, /const BUILD = "1\.1\.1"/);
  assert.match(source, /const PROTOCOL = 1/);
  assert.doesNotMatch(source, /\bdocument\b/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|chrome\.storage/);
  assert.doesNotMatch(source, /\bfetch\b|XMLHttpRequest|WebSocket|sendBeacon/);
});

function runSentinel({ topFrame, executions = 1 }) {
  const listeners = [];
  const readyMessages = [];
  const windowObject = {};
  windowObject.top = topFrame ? windowObject : {};
  const context = vm.createContext({
    window: windowObject,
    chrome: {
      runtime: {
        id: "extension-id",
        sendMessage(message) {
          readyMessages.push(clone(message));
          return Promise.resolve({ ok: true });
        },
        onMessage: {
          addListener(listener) {
            listeners.push(listener);
          }
        }
      }
    }
  });
  for (let index = 0; index < executions; index += 1) vm.runInContext(source, context);
  return {
    listeners,
    readyMessages,
    send(message, senderId = "extension-id") {
      let response;
      for (const listener of listeners) {
        listener(clone(message), { id: senderId }, (value) => { response = clone(value); });
      }
      return response;
    }
  };
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
