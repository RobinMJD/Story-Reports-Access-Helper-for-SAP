import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchTextWithPolicy,
  fetchWithPolicy,
  getRetryDelayMs
} from "../scripts/http-request.mjs";

test("Store HTTP policy retries bounded transient responses and honors Retry-After", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return calls === 1
      ? new Response("busy", { status: 503, headers: { "retry-after": "0" } })
      : new Response("ok", { status: 200 });
  });

  const response = await fetchWithPolicy("https://store.example/status", {}, { attempts: 2 });
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test("Store HTTP policy retries a polling network failure only when requested", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("temporary network failure");
    return new Response("ok", { status: 200 });
  });

  const response = await fetchWithPolicy(
    "https://store.example/status",
    {},
    { attempts: 2, retryNetwork: true }
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test("Store HTTP policy does not repeat a single-attempt mutation", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    throw new TypeError("ambiguous network failure");
  });

  await assert.rejects(
    fetchWithPolicy(
      "https://store.example/mutation",
      { method: "POST" },
      { attempts: 1, retryStatuses: false }
    ),
    /ambiguous network failure/
  );
  assert.equal(calls, 1);
});

test("Store HTTP policy aborts a stalled request and defaults to 30 seconds", async (t) => {
  assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 30_000);
  t.mock.method(globalThis, "fetch", (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener(
      "abort",
      () => reject(new DOMException("aborted", "AbortError")),
      { once: true }
    );
  }));

  await assert.rejects(
    fetchWithPolicy("https://store.example/hang", {}, { timeoutMs: 20 }),
    /timed out/i
  );
});

test("Store HTTP policy bounds a stalled mutation response body without repeating it", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    calls += 1;
    return {
      status: 200,
      text: () => new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true }
        );
      })
    };
  });

  await assert.rejects(
    fetchTextWithPolicy(
      "https://store.example/stalled-body",
      { method: "POST" },
      { attempts: 1, retryStatuses: false, timeoutMs: 20 }
    ),
    /timed out/i
  );
  assert.equal(calls, 1);
});

test("Store HTTP policy caps Retry-After and exponential backoff", () => {
  assert.equal(getRetryDelayMs("999", 1), 10_000);
  assert.equal(getRetryDelayMs("0", 1), 0);
  assert.equal(getRetryDelayMs(null, 1), 250);
  assert.equal(getRetryDelayMs(null, 10), 4_000);
});
