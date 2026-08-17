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

test("release builds one exact Edge-only artifact and reuses the verified bytes", () => {
  assert.equal(
    (release.match(/^\s+release\/story-reports-access-helper-for-sap-\$\{\{ env\.RELEASE_TAG \}\}-microsoft-edge-addons\.zip$/gm) || []).length,
    1
  );
  assert.doesNotMatch(release, /chromium-stores|chrome-web-store|CHROME_WEBSTORE/i);
  assert.match(release, /name: microsoft-edge-addons-package-\$\{\{ env\.RELEASE_TAG \}\}/);
  assert.match(release, /environment: microsoft-edge-add-ons/);
  assert.match(release, /EDGE_ADDONS_AUTOMATION_ENABLED == 'true'/);
  assert.match(release, /EDGE_ADDONS_MANUAL_SUBMISSION_TAG != \(github\.event_name == 'workflow_dispatch' && inputs\.tag \|\| github\.ref_name\)/);
  assert.match(release, /Existing release asset differs; refusing overwrite/);
  assert.match(release, /cancel-in-progress: false/);
  assert.match(release, /group: store-release-\$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.tag \|\| github\.ref_name \}\}/);
  assert.match(release, /verified_commit: \$\{\{ steps\.release_commit\.outputs\.sha \}\}/);
  assert.equal((release.match(/ref: \$\{\{ needs\.verify-package\.outputs\.verified_commit \}\}/g) || []).length, 2);
  assert.equal((release.match(/sha256sum --check SHA256SUMS\.txt/g) || []).length, 3);
  assert.match(release, /gh release download "\$RELEASE_TAG"/);
  assert.match(release, /cmp "release\/\$ZIP" "github-release\/\$ZIP"/);
  assert.match(release, /cmp release\/SHA256SUMS\.txt github-release\/SHA256SUMS\.txt/);
  assert.match(release, /EDGE_ADDONS_ZIP: github-release\/story-reports-access-helper-for-sap-/);
  assert.doesNotMatch(release, /needs\.github-release\.result != 'failure'/);
  assert.match(release, /needs\.github-release\.result == 'success'/);
  assert.doesNotMatch(release, /Checkout publisher from exact tag/);
});

test("first manual submissions and targeted retries are explicit", () => {
  assert.match(release, /EDGE_ADDONS_AUTOMATION_ENABLED/);
  assert.match(release, /EDGE_ADDONS_MANUAL_SUBMISSION_TAG/);
  for (const target of ["github", "edge"]) assert.match(release, new RegExp(`- ${target}`));
  assert.doesNotMatch(release, /- chrome/);
});
