import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import path from "node:path";

export const ALLOWED_IMAGE_EXTENSIONS = Object.freeze(new Set([".jpeg", ".jpg", ".png", ".webp"]));
export const ALLOWED_IMAGE_CONTENT_TYPES = Object.freeze(new Set(["image/jpeg", "image/png", "image/webp"]));

const MAX_EDGE = 12_000;
const MAX_PIXELS = 40_000_000;

function fail(message) {
  throw new TypeError(`invalid image: ${message}`);
}

function parsePng(buffer) {
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") fail("PNG is missing its IHDR header");
  return {format: "png", mimeType: "image/png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20)};
}

const JPEG_START_OF_FRAME = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function parseJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < buffer.length) {
    while (offset < buffer.length && buffer[offset] !== 0xff) offset += 1;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > buffer.length) fail("JPEG contains a truncated segment");
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) fail("JPEG contains an invalid segment length");
    if (JPEG_START_OF_FRAME.has(marker)) {
      if (length < 7) fail("JPEG frame header is truncated");
      return {format: "jpeg", mimeType: "image/jpeg", width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3)};
    }
    offset += length;
  }
  fail("JPEG dimensions were not found");
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function parseWebp(buffer) {
  if (buffer.length < 30 || buffer.subarray(0, 4).toString("ascii") !== "RIFF" || buffer.subarray(8, 12).toString("ascii") !== "WEBP") return null;
  const chunk = buffer.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") {
    return {format: "webp", mimeType: "image/webp", width: readUInt24LE(buffer, 24) + 1, height: readUInt24LE(buffer, 27) + 1};
  }
  if (chunk === "VP8 ") {
    if (buffer.length < 30 || buffer.subarray(23, 26).toString("hex") !== "9d012a") fail("WebP VP8 frame header is invalid");
    return {format: "webp", mimeType: "image/webp", width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff};
  }
  if (chunk === "VP8L") {
    if (buffer.length < 25 || buffer[20] !== 0x2f) fail("WebP VP8L frame header is invalid");
    const b1 = buffer[21];
    const b2 = buffer[22];
    const b3 = buffer[23];
    const b4 = buffer[24];
    return {
      format: "webp",
      mimeType: "image/webp",
      width: 1 + (b1 | ((b2 & 0x3f) << 8)),
      height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
    };
  }
  fail(`unsupported WebP chunk: ${chunk || "missing"}`);
}

function expectedFormatForExtension(extension) {
  if (extension === ".png") return "png";
  if (extension === ".jpg" || extension === ".jpeg") return "jpeg";
  if (extension === ".webp") return "webp";
  fail(`unsupported extension: ${extension || "missing"}`);
}

export function inspectImageBytes(value, {extension, contentType, maxEdge = MAX_EDGE, maxPixels = MAX_PIXELS} = {}) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
  const normalizedExtension = String(extension ?? "").toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.has(normalizedExtension)) fail(`unsupported extension: ${normalizedExtension || "missing"}`);
  if (contentType !== undefined && !ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) fail(`unsupported content type: ${contentType}`);
  const parsed = parsePng(buffer) ?? parseJpeg(buffer) ?? parseWebp(buffer);
  if (!parsed) fail("signature does not match PNG, JPEG, or WebP");
  if (parsed.format !== expectedFormatForExtension(normalizedExtension)) fail("file extension does not match image signature");
  if (contentType !== undefined && parsed.mimeType !== contentType) fail("content type does not match image signature");
  if (!Number.isInteger(parsed.width) || !Number.isInteger(parsed.height) || parsed.width < 1 || parsed.height < 1) fail("dimensions must be positive integers");
  if (parsed.width > maxEdge || parsed.height > maxEdge) fail(`edge exceeds ${maxEdge} pixels`);
  if (parsed.width * parsed.height > maxPixels) fail(`pixel count exceeds ${maxPixels}`);
  return {
    ...parsed,
    bytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

export async function inspectImageFile(filePath, options = {}) {
  const buffer = await readFile(filePath);
  return inspectImageBytes(buffer, {extension: path.extname(filePath).toLowerCase(), ...options});
}
