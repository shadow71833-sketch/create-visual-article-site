import {createWriteStream} from "node:fs";
import {mkdir, rename, rm} from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {pathToFileURL} from "node:url";
import {once} from "node:events";

import {ALLOWED_IMAGE_CONTENT_TYPES, inspectImageFile} from "./lib/image-inspection.mjs";
import {
  assertApprovedDescendant,
  assertNoSymlinkWithin,
  pathExists,
  resolveSafeRemoteUrl,
  resolveWithin,
  sanitizePublicUrl,
} from "./lib/security.mjs";

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 4;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function parsePositiveInteger(value, label, {allowZero = false} = {}) {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new TypeError(`${label} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
  return value;
}

function responseHeaders(headers) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value ?? "")]));
  return {get: (name) => normalized.get(String(name).toLowerCase()) ?? null};
}

async function pinnedRequest(url, address, {signal}) {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: "GET",
      signal,
      headers: {accept: "image/webp,image/png,image/jpeg"},
      lookup: (_hostname, _options, callback) => callback(null, address, net.isIP(address)),
      ...(url.protocol === "https:" ? {servername: url.hostname} : {}),
    }, (response) => resolve({
      status: response.statusCode ?? 0,
      ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
      headers: responseHeaders(response.headers),
      body: response,
    }));
    request.once("error", reject);
    request.end();
  });
}

async function nextBodyChunkReader(body) {
  if (typeof body.getReader === "function") {
    const reader = body.getReader();
    return {
      async next() {
        const result = await reader.read();
        return result.done ? {done: true} : {done: false, value: result.value};
      },
      async cancel(error) { await reader.cancel(error).catch(() => {}); },
    };
  }
  const iterator = body[Symbol.asyncIterator]?.();
  if (!iterator) throw new TypeError("download response body is not readable");
  return {
    next: () => iterator.next(),
    async cancel(error) {
      if (typeof iterator.return === "function") await iterator.return().catch(() => {});
      body.destroy?.(error);
    },
  };
}

async function writeResponseBody(response, temporaryPath, maxBytes) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RangeError(`download exceeds the ${maxBytes}-byte size limit`);
  }
  if (!response.body) throw new TypeError("download response has no body");

  const stream = createWriteStream(temporaryPath, {flags: "wx", mode: 0o600});
  const reader = await nextBodyChunkReader(response.body);
  let bytes = 0;
  let streamError;
  stream.on("error", (error) => { streamError = error; });

  try {
    while (true) {
      const {done, value} = await reader.next();
      if (done) break;
      const chunk = Buffer.from(value);
      bytes += chunk.byteLength;
      if (bytes > maxBytes) throw new RangeError(`download exceeds the ${maxBytes}-byte size limit`);
      if (!stream.write(chunk)) await once(stream, "drain");
      if (streamError) throw streamError;
    }
    stream.end();
    await once(stream, "close");
    if (streamError) throw streamError;
    return bytes;
  } catch (error) {
    stream.destroy();
    await reader.cancel(error);
    throw error;
  }
}

export async function downloadAsset({
  url,
  approvedOutputRoot,
  outputRoot,
  relativePath,
  fetchImpl,
  resolveAddresses,
  maxBytes = DEFAULT_MAX_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
} = {}) {
  if (fetchImpl !== undefined && typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function when provided");
  parsePositiveInteger(maxBytes, "maxBytes");
  parsePositiveInteger(timeoutMs, "timeoutMs");
  parsePositiveInteger(maxRedirects, "maxRedirects", {allowZero: true});

  const resolvedApprovedRoot = path.resolve(approvedOutputRoot);
  const resolvedOutputRoot = assertApprovedDescendant(resolvedApprovedRoot, path.resolve(outputRoot));
  await assertNoSymlinkWithin(resolvedApprovedRoot, resolvedOutputRoot);
  const destination = resolveWithin(resolvedOutputRoot, relativePath);
  if (await pathExists(destination)) throw new Error(`destination already exists: ${relativePath}`);
  await mkdir(path.dirname(destination), {recursive: true, mode: 0o700});
  const temporaryPath = `${destination}.part-${randomUUID()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("download timed out")), timeoutMs);
  let currentUrl = sanitizePublicUrl(url);

  try {
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const {url: safeUrl, addresses} = await resolveSafeRemoteUrl(currentUrl, {resolveAddresses});
      const response = fetchImpl
        ? await fetchImpl(safeUrl, {redirect: "manual", signal: controller.signal, headers: {accept: "image/webp,image/png,image/jpeg"}})
        : await pinnedRequest(safeUrl, addresses[0], {signal: controller.signal});

      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirectCount === maxRedirects) throw new Error(`download exceeded ${maxRedirects} redirects`);
        const location = response.headers.get("location");
        if (!location) throw new Error("redirect response is missing a location header");
        response.body?.cancel?.().catch?.(() => {});
        response.body?.destroy?.();
        currentUrl = sanitizePublicUrl(new URL(location, safeUrl).toString());
        continue;
      }
      if (!response.ok) throw new Error(`download failed with HTTP ${response.status}`);

      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
        throw new TypeError(`download content type is not allowed: ${contentType ?? "missing"}`);
      }
      const bytes = await writeResponseBody(response, temporaryPath, maxBytes);
      const inspection = await inspectImageFile(temporaryPath, {extension: path.extname(destination).toLowerCase(), contentType});
      if (inspection.mimeType !== contentType) throw new TypeError(`download MIME type does not match file signature: ${contentType} vs ${inspection.mimeType}`);
      await rename(temporaryPath, destination);
      return {
        sourceUrl: safeUrl.toString(),
        relativePath,
        contentType,
        bytes,
        sha256: inspection.sha256,
        width: inspection.width,
        height: inspection.height,
      };
    }
    throw new Error("unreachable redirect state");
  } catch (error) {
    await rm(temporaryPath, {force: true}).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new TypeError("Usage: node safe-download.mjs --url <url> --approved-root <dir> --output-root <dir> --relative-path <path>");
    }
    options[name.slice(2)] = value;
  }
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  const result = await downloadAsset({
    url: options.url,
    approvedOutputRoot: options["approved-root"],
    outputRoot: options["output-root"],
    relativePath: options["relative-path"],
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
