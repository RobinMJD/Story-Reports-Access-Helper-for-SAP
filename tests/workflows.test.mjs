import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

test("CI verifies source, audit, deterministic Edge package, and checksum", () => {
  for (const required of ["npm ci", "npm audit --audit-level=low", "npm run verify", "npm run package:edge", "npm run verify:edge-package"]) {
    assert.match(ci, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(ci, /steps\.package\.outputs\.zip/);
  assert.doesNotMatch(ci, /chromium-stores|chrome-web-store/i);
  assert.match(ci, /microsoft-edge-addons-package/);
});

test("release builds one exact Edge-only artifact and publishes immutable GitHub assets", () => {
  const packagePath = "release/story-reports-access-helper-for-sap-${{ env.RELEASE_TAG }}-microsoft-edge-addons.zip";
  assert.equal(release.split(packagePath).length - 1, 1);
  assert.doesNotMatch(release, /chromium-stores|chrome-web-store|CHROME_WEBSTORE/i);
  assert.match(release, /name: microsoft-edge-addons-package-\$\{\{ env\.RELEASE_TAG \}\}/);
  assert.match(release, /Existing release asset differs; refusing overwrite/);
  assert.match(release, /cancel-in-progress: false/);
  assert.match(release, /group: store-release-\$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.tag \|\| github\.ref_name \}\}/);
  assert.match(release, /verified_commit: \$\{\{ steps\.release_commit\.outputs\.sha \}\}/);
  assert.equal((release.match(/ref: \$\{\{ needs\.verify-package\.outputs\.verified_commit \}\}/g) || []).length, 1);
  assert.equal((release.match(/sha256sum --check SHA256SUMS\.txt/g) || []).length, 1);
  assert.doesNotMatch(release, /Checkout publisher from exact tag/);
});

test("Microsoft Edge Add-ons submission remains manual", () => {
  assert.doesNotMatch(
    release,
    /publish_target|EDGE_ADDONS_|scripts\/publish-edge-addons|Submit to Microsoft Edge Add-ons|environment: microsoft-edge-addons/
  );
  assert.match(release, /workflow_dispatch:\s*\n\s*inputs:\s*\n\s*tag:/);
});
