import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const excludedRoots = new Set([".git", "node_modules", "qa", "release"]);
const forbiddenSuffixes = [".har", ".key", ".p12", ".pfx", ".pem"];
const privateMarkers = [
  ["so", "nepar"].join(""),
  ["sone", "people"].join(""),
  ["performance", "manager5"].join(""),
  ["apy1", "lfna5"].join(""),
  ["wei", "yuan"].join(""),
  ["guil", "laume"].join(""),
  ["ole", "na"].join("")
];

test("the public release tree excludes customer evidence, secrets, and private captures", () => {
  const files = collectPublicFiles(projectRoot);
  assert.ok(files.length > 0);

  for (const path of files) {
    const publicPath = relative(projectRoot, path).replaceAll("\\", "/");
    const normalizedName = basename(path).toLowerCase();
    assert.equal(forbiddenSuffixes.some((suffix) => normalizedName.endsWith(suffix)), false, publicPath);

    const bytes = readFileSync(path);
    const searchable = `${publicPath}\n${bytes.toString("latin1")}`.toLowerCase();
    for (const marker of privateMarkers) {
      assert.equal(searchable.includes(marker), false, `${publicPath} contains a private marker`);
    }
  }

  const ignore = readFileSync(resolve(projectRoot, ".gitignore"), "utf8");
  assert.match(ignore, /^release\/$/m);
  assert.match(ignore, /^qa\/$/m);
  assert.match(ignore, /^\.DS_Store$/m);
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^\*\.har$/m);
  assert.match(ignore, /^\.env\.\*$/m);
});

function collectPublicFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (directory === projectRoot && excludedRoots.has(entry.name)) continue;
    if (entry.name === ".DS_Store" || entry.name === ".env" || entry.name.startsWith(".env.")) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectPublicFiles(path));
    else if (entry.isFile() && statSync(path).size <= 8 * 1024 * 1024) files.push(path);
  }
  return files;
}
