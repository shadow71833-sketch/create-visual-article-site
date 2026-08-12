import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {inspectImageBytes} from "../lib/image-inspection.mjs";

const fixturePngUrl = new URL("./fixtures/assets/comic/test-comic.png", import.meta.url);

test("inspects valid image signatures and dimensions", async () => {
  const result = inspectImageBytes(await readFile(fixturePngUrl), {extension: ".png", contentType: "image/png"});
  assert.equal(result.format, "png");
  assert.equal(result.width, 1536);
  assert.equal(result.height, 1024);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test("rejects extension mismatches and oversized decoded dimensions", async () => {
  const valid = await readFile(fixturePngUrl);
  assert.throws(() => inspectImageBytes(valid, {extension: ".jpg"}), /extension does not match/);
  const oversized = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(oversized, 0);
  Buffer.from("IHDR", "ascii").copy(oversized, 12);
  oversized.writeUInt32BE(12_000, 16);
  oversized.writeUInt32BE(12_000, 20);
  assert.throws(() => inspectImageBytes(oversized, {extension: ".png"}), /pixel count/);
});
