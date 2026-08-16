import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEdgeEndpoints,
  extractEdgeOperationId,
  getMissingEdgeConfig,
  getEdgeOperationStatus,
  normalizeEdgeCredential,
  sanitizeEdgeMessage
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
});
