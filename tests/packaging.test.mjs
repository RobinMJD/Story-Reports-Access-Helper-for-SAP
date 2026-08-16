import test from "node:test";
import assert from "node:assert/strict";
import { createStoredZip } from "../scripts/package-edge.mjs";

test("Microsoft Edge Add-ons ZIP generation is deterministic and has manifest at the archive root", () => {
  const entries = [
    { name: "src/a.js", data: Buffer.from("a") },
    { name: "manifest.json", data: Buffer.from('{"manifest_version":3}') }
  ];
  const first = createStoredZip(entries);
  const second = createStoredZip([...entries].reverse());
  assert.deepEqual(first, second);
  assert.equal(first.readUInt32LE(0), 0x04034b50);
  assert.match(first.toString("utf8"), /manifest\.json/);
  const firstCentralHeader = first.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.notEqual(firstCentralHeader, -1);
  assert.equal(first.readUInt32LE(firstCentralHeader + 38) >>> 16, 0o100644);
});
