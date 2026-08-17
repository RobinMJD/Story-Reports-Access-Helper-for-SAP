import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

const screenshots = [
  "screenshot-01-automatic-fix-1280x800.png",
  "screenshot-02-simple-status-1280x800.png",
  "screenshot-03-built-in-help-1280x800.png",
  "screenshot-04-private-by-design-1280x800.png"
];

const expectedAssets = new Map([
  ["store-icon-300.png", { width: 300, height: 300 }],
  ["small-promo-440x280.png", { width: 440, height: 280 }],
  ["large-promo-1400x560.png", { width: 1400, height: 560 }],
  ...screenshots.map((fileName) => [fileName, { width: 1280, height: 800 }])
]);

test("Microsoft Edge Store assets use the official dimensions", () => {
  assert.ok(screenshots.length <= 6, "Microsoft Edge accepts at most six screenshots");

  for (const [fileName, dimensions] of expectedAssets) {
    assert.deepEqual(readPngDimensions(resolve("store/assets", fileName)), dimensions, fileName);
  }
});

test("public documentation images are exact copies of Store assets", () => {
  for (const fileName of expectedAssets.keys()) {
    assert.deepEqual(
      readFileSync(resolve("docs/images", fileName)),
      readFileSync(resolve("store/assets", fileName)),
      fileName
    );
  }
});

test("the renderer records overflow and safe-bound checks for every Store asset", () => {
  const report = JSON.parse(readFileSync(resolve("store/assets/store-assets-validation.json"), "utf8"));
  const names = report.results.map(({ fileName }) => fileName);

  assert.equal(report.specification.authority, "Microsoft Edge Developer documentation");
  assert.equal(
    report.specification.url,
    "https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension"
  );
  assert.equal(report.specification.checkedOn, "2026-08-17");
  assert.deepEqual(new Set(names), new Set(expectedAssets.keys()));
  assert.ok(report.results.every(({ overflowFree, safeBounds }) => overflowFree && safeBounds));
  assert.ok(report.results.every(({ checkedSafeElements }) => checkedSafeElements > 0));
  assert.equal(report.contentSafety.realCustomerData, false);
  assert.equal(report.contentSafety.realHostnames, false);
  assert.equal(report.contentSafety.realPeople, false);
  assert.equal(report.contentSafety.realReportNames, false);
  assert.equal(report.contentSafety.thirdPartyLogos, false);
});

test("marketing sources use the original mark and contain no customer-specific material", () => {
  const generator = readFileSync(resolve("scripts/generate-store-assets.mjs"), "utf8");
  const icon = readFileSync(resolve("icons/icon-source.svg"), "utf8");
  const publicSources = `${generator}\n${icon}`;

  assert.match(generator, /icons\/icon-source\.svg/);
  assert.match(generator, /SAP Knowledge Base article 3039244/);
  assert.doesNotMatch(publicSources, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  assert.doesNotMatch(publicSources, /https:\/\/[^"'\s]*successfactors\./i);
  assert.doesNotMatch(publicSources, /\b(?:tenant|customer|report)[-_]?[0-9]{2,}\b/i);
  assert.doesNotMatch(icon, /sap|successfactors|microsoft|edge/i);
});

test("marketing copy reflects live status and never instructs users to reopen the popup or Story", () => {
  const generator = readFileSync(resolve("scripts/generate-store-assets.mjs"), "utf8");

  assert.match(generator, /Checking this report/);
  assert.match(generator, /This status updates automatically/);
  assert.match(generator, /Fix this report/);
  assert.match(generator, /Access fix applied/);
  assert.match(generator, /hides the Fix button/);
  assert.doesNotMatch(generator, /reopen/i);
  assert.doesNotMatch(generator, /Fix not applied/);
  assert.doesNotMatch(generator, /open the Story again/i);
});

test("the deterministic generator and public README include all four final screenshots", () => {
  const generator = readFileSync(resolve("scripts/generate-store-assets.mjs"), "utf8");
  const readme = readFileSync(resolve("README.md"), "utf8");
  for (const fileName of screenshots) {
    assert.match(generator, new RegExp(fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(readme, new RegExp(fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

function readPngDimensions(path) {
  const png = readFileSync(path);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", path);
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20)
  };
}
