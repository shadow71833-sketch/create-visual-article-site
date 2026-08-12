import assert from "node:assert/strict";
import {mkdir, mkdtemp, readFile, rm, symlink} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertSafeRelativePath,
  assertSafeRemoteUrl,
  escapeAttribute,
  escapeHtml,
  isBlockedNetworkAddress,
  sensitiveValueFindings,
  resolveWithin,
  sanitizePublicUrl,
} from "../lib/security.mjs";
import { downloadAsset } from "../safe-download.mjs";

const publicResolver = async () => ["93.184.216.34"];
const fixturePngUrl = new URL("./fixtures/assets/comic/test-comic.png", import.meta.url);

test("escapes hostile HTML and attribute content", () => {
  assert.equal(escapeHtml(`<script>alert("x")</script>`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  assert.equal(escapeAttribute(`x" onerror="alert(1)`), "x&quot; onerror=&quot;alert(1)");
});

test("sanitizes public URLs and removes sensitive parameters", () => {
  const sanitized = sanitizePublicUrl("https://example.com/a?utm_source=x&token=secret&id=42#part");
  assert.equal(sanitized, "https://example.com/a?id=42#part");
  assert.throws(() => sanitizePublicUrl("javascript:alert(1)"), /HTTP/);
  assert.throws(() => sanitizePublicUrl("https://user:pass@example.com"), /credentials/);
  assert.throws(() => sanitizePublicUrl("http://127.0.0.1/private"), /blocked/);
  assert.throws(() => sanitizePublicUrl("http://[::1]/private"), /blocked/);
  assert.equal(sanitizePublicUrl("https://example.com/#access_token=secret&part=2"), "https://example.com/#part=2");
  assert.equal(sanitizePublicUrl("https://example.com/#/callback?access_token=secret"), "https://example.com/");
});

test("rejects path traversal and resolves safe paths inside a root", () => {
  assert.equal(assertSafeRelativePath("assets/image.png"), "assets/image.png");
  assert.throws(() => assertSafeRelativePath("../secret"), /relative path/);
  assert.throws(() => assertSafeRelativePath("/tmp/secret"), /relative path/);
  assert.equal(resolveWithin("/tmp/output", "assets/image.png"), path.join("/tmp/output", "assets/image.png"));
});

test("blocks local, private, credentialed, and DNS-resolved private targets", async () => {
  await assert.rejects(() => assertSafeRemoteUrl("http://127.0.0.1/a", {resolveAddresses: publicResolver}), /blocked/);
  await assert.rejects(() => assertSafeRemoteUrl("http://[::1]/a", {resolveAddresses: publicResolver}), /blocked/);
  assert.equal(isBlockedNetworkAddress("::ffff:7f00:1"), true);
  assert.equal(isBlockedNetworkAddress("2001:db8::1"), true);
  assert.equal(isBlockedNetworkAddress("64:ff9b::c0a8:1"), true);
  assert.equal(isBlockedNetworkAddress("2002:c0a8:1::"), true);
  await assert.rejects(() => assertSafeRemoteUrl("https://user:pass@example.com/a", {resolveAddresses: publicResolver}), /credentials/);
  await assert.rejects(
    () => assertSafeRemoteUrl("https://example.com/a", {resolveAddresses: async () => ["10.0.0.2"]}),
    /blocked/,
  );
  const safe = await assertSafeRemoteUrl("https://example.com/a", {resolveAddresses: publicResolver});
  assert.equal(safe.hostname, "example.com");
});

test("detects credential-shaped values without returning the secret", () => {
  const findings = sensitiveValueFindings({nested: {value: `sk-${"a".repeat(24)}`}});
  assert.deepEqual(findings, [{path: "$.nested.value", pattern: "openai-key"}]);
  assert.doesNotMatch(JSON.stringify(findings), /sk-/);
});

test("downloads an allowed image with injected network primitives", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-download-"));
  try {
    const validPng = await readFile(fixturePngUrl);
    const result = await downloadAsset({
      url: "https://example.com/image.png",
      approvedOutputRoot: root,
      outputRoot: path.join(root, "downloads"),
      relativePath: "assets/original/image.png",
      resolveAddresses: publicResolver,
      fetchImpl: async () => new Response(validPng, {
        status: 200,
        headers: {"content-type": "image/png", "content-length": String(validPng.length)},
      }),
    });
    assert.equal(result.bytes, validPng.length);
    assert.equal(result.width, 1536);
    assert.deepEqual(await readFile(path.join(root, "downloads", "assets/original/image.png")), validPng);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects invalid MIME, oversized responses, and private redirects", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-download-"));
  try {
    await assert.rejects(() => downloadAsset({
      url: "https://example.com/file.txt",
      approvedOutputRoot: root,
      outputRoot: path.join(root, "downloads"),
      relativePath: "assets/file.txt",
      resolveAddresses: publicResolver,
      fetchImpl: async () => new Response("text", {headers: {"content-type": "text/plain"}}),
    }), /content type/);

    await assert.rejects(() => downloadAsset({
      url: "https://example.com/large.png",
      approvedOutputRoot: root,
      outputRoot: path.join(root, "downloads"),
      relativePath: "assets/large.png",
      maxBytes: 2,
      resolveAddresses: publicResolver,
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), {
        headers: {"content-type": "image/png", "content-length": "3"},
      }),
    }), /size limit/);

    await assert.rejects(() => downloadAsset({
      url: "https://example.com/redirect",
      approvedOutputRoot: root,
      outputRoot: path.join(root, "downloads"),
      relativePath: "assets/redirect.png",
      resolveAddresses: publicResolver,
      fetchImpl: async () => new Response(null, {status: 302, headers: {location: "http://127.0.0.1/private"}}),
    }), /blocked/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects symbolic links inside an approved output root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-symlink-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "visual-article-outside-"));
  try {
    await mkdir(path.join(root, "downloads"), {recursive: true});
    await symlink(outside, path.join(root, "downloads", "linked"));
    await assert.rejects(downloadAsset({
      url: "https://example.com/image.png",
      approvedOutputRoot: root,
      outputRoot: path.join(root, "downloads", "linked"),
      relativePath: "assets/image.png",
      resolveAddresses: publicResolver,
      fetchImpl: async () => new Response(await readFile(fixturePngUrl), {headers: {"content-type": "image/png"}}),
    }), /symbolic link/);
  } finally {
    await rm(root, {recursive: true, force: true});
    await rm(outside, {recursive: true, force: true});
  }
});
