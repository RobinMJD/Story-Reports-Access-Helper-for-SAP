import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

if (!versionPattern.test(manifest.version)) throw new Error(`Invalid manifest version: ${manifest.version}`);
if (packageJson.version !== manifest.version) {
  throw new Error(`Version mismatch: package.json=${packageJson.version}, manifest.json=${manifest.version}`);
}

const suppliedTag = process.argv[2] || process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || "";
if (suppliedTag && suppliedTag !== `v${manifest.version}`) {
  throw new Error(`Tag/version mismatch: tag=${suppliedTag}, manifest=v${manifest.version}`);
}

console.log(`Version consumers agree on ${manifest.version}${suppliedTag ? ` (${suppliedTag})` : ""}.`);
