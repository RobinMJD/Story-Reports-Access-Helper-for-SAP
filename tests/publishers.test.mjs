import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEdgeCertificationRequest,
  buildEdgeEndpoints,
  extractEdgeOperationId,
  getMissingEdgeConfig,
  getEdgeOperationStatus,
  normalizeEdgeCredential,
  pollOperation,
  readEdgeConfig,
  sanitizeEdgeMessage,
  startOperation
} from "../scripts/publish-edge-addons.mjs";

test("Edge publisher uses v1.1 API-key endpoints and normalizes copied credentials", () => {
  const endpoints = buildEdgeEndpoints("product-id");
  assert.equal(endpoints.uploadUrl, "https://api.addons.microsoftedge.microsoft.com/v1/products/product-id/submissions/draft/package");
  assert.equal(extractEdgeOperationId(`${endpoints.uploadUrl}/operations/abc-123`), "abc-123");
  assert.equal(extractEdgeOperationId("../../unsafe"), "");
  assert.equal(getEdgeOperationStatus({ status: "Succeeded" }), "succeeded");
  assert.equal(normalizeEdgeCredential("abc\r\ndef\n"), "abcdef");
  assert.deepEqual(
    getMissingEdgeConfig({
      EDGE_ADDONS_CLIENT_ID: "client",
      EDGE_ADDONS_API_KEY: "key",
      EDGE_ADDONS_PRODUCT_ID: "product",
      EDGE_ADDONS_ZIP: "package.zip"
    }),
    ["EDGE_ADDONS_CERTIFICATION_NOTES"]
  );
});

test("publisher diagnostics redact Microsoft Edge API credentials", () => {
  assert.doesNotMatch(sanitizeEdgeMessage("Authorization: ApiKey super-secret"), /super-secret/);
  assert.equal(sanitizeEdgeMessage("x".repeat(5_000)).length, 4_000);
});

test("Edge publisher starts a state-changing operation exactly once", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return new Response("temporarily unavailable", { status: 503 });
  });

  await assert.rejects(
    startOperation("https://api.addons.microsoftedge.microsoft.com/v1/products/p/submissions", {
      method: "POST"
    }),
    /failed \(503\)/
  );
  assert.equal(calls, 1);
});

test("Edge publisher retries transient GET polling failures and fails closed on unknown status", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 1) {
      return new Response("busy", { status: 503, headers: { "retry-after": "0" } });
    }
    return new Response(JSON.stringify({ status: "Unexpected" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });

  await assert.rejects(
    pollOperation("https://api.addons.microsoftedge.microsoft.com/status", {}, 1, 0, "submission"),
    /unknown status unexpected/i
  );
  assert.equal(calls, 2);
});

test("Edge publisher sends plain-text certification notes", () => {
  const request = buildEdgeCertificationRequest({ Authorization: "ApiKey secret" }, "Reviewer note");
  assert.equal(request.method, "POST");
  assert.equal(request.headers["Content-Type"], "text/plain; charset=utf-8");
  assert.equal(request.body, "Reviewer note");
});

test("Edge certification notes disclose v1.1.1 recovery and manual-fix boundaries", () => {
  const notes = readEdgeConfig({
    EDGE_ADDONS_CLIENT_ID: "client",
    EDGE_ADDONS_API_KEY: "key",
    EDGE_ADDONS_PRODUCT_ID: "product",
    EDGE_ADDONS_ZIP: "package.zip",
    EDGE_ADDONS_CERTIFICATION_NOTES: "Exact candidate evidence supplied by the release workflow."
  }).certificationNotes;

  for (const required of [
    "exact active Report Center path",
    "same-build service-worker start including re-enablement",
    "tab activation",
    "URL-change or page-completion events",
    "trusted-local marker stores only the current extension build/version",
    "five-second fail-closed deadline",
    "Checking this report",
    "non-overlapping status checks",
    "advisory tab-loading value",
    "Fix this report",
    "result is returned for display",
    "30-second repeat guard",
    "never clears browser cookies",
    "document's lifetime",
    "arbitrary ten-second cutoff",
    "Access fix applied means either",
    "https://userapps.support.sap.com/sap/support/knowledge/en/3039244"
  ]) {
    assert.match(notes, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(notes, /does not prove network delivery, SAP authentication, authorization, or Story rendering/);
});
