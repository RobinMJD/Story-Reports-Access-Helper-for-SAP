import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PACKAGE_FILES } from "./package-edge.mjs";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archiveName = `story-reports-access-helper-for-sap-v${manifest.version}-microsoft-edge-addons.zip`;
const archivePath = resolve(fileURLToPath(new URL("../release/", import.meta.url)), archiveName);

const listing = spawnSync("unzip", ["-Z1", archivePath], { encoding: "utf8" });
if (listing.status !== 0) throw new Error(`Cannot inspect Store ZIP: ${listing.stderr.trim()}`);
const actualFiles = listing.stdout.trim().split(/\r?\n/).filter(Boolean).sort();
const expectedFiles = [...PACKAGE_FILES].sort();
if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error(`Unexpected Store ZIP contents:\n${actualFiles.join("\n")}`);
}

for (const file of expectedFiles) {
  const archived = spawnSync("unzip", ["-p", archivePath, file], { maxBuffer: 16 * 1024 * 1024 });
  if (archived.status !== 0) throw new Error(`Cannot read ${file} from Store ZIP: ${String(archived.stderr).trim()}`);
  const source = readFileSync(resolve(projectRoot, file));
  if (!Buffer.from(archived.stdout).equals(source)) {
    throw new Error(`Packaged file differs from current source: ${file}`);
  }
}

const manifestResult = spawnSync("unzip", ["-p", archivePath, "manifest.json"], { encoding: "utf8" });
if (manifestResult.status !== 0) throw new Error(`Cannot read packaged manifest: ${manifestResult.stderr.trim()}`);
const packagedManifest = JSON.parse(manifestResult.stdout);
if (packagedManifest.version !== manifest.version || packagedManifest.manifest_version !== 3) {
  throw new Error("Packaged manifest version or format differs from source.");
}

const bytes = readFileSync(archivePath);
const digest = createHash("sha256").update(bytes).digest("hex");
const expectedLine = `${digest}  ${archiveName}`;
const checksum = readFileSync(new URL("../release/SHA256SUMS.txt", import.meta.url), "utf8").trim();
if (checksum !== expectedLine) throw new Error("SHA256SUMS.txt does not match the Store ZIP.");

console.log(`Verified ${archiveName} (${actualFiles.length} files, SHA-256 ${digest}).`);
