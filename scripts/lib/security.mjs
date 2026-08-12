import dns from "node:dns/promises";
import { constants as fsConstants } from "node:fs";
import { access, lstat, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SENSITIVE_QUERY_PATTERN = /^(?:access[_-]?token|api[_-]?key|auth|authorization|code|credential|jwt|key|password|secret|session|signature|sig|token|x-amz-.+)$/i;
const TRACKING_QUERY_PATTERN = /^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i;

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function parseHttpUrl(rawUrl) {
  requireString(rawUrl, "URL");
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new TypeError(`URL is invalid: ${error.message}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError("URL must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new TypeError("URL credentials are not allowed");
  }
  return parsed;
}

export function sanitizePublicUrl(rawUrl) {
  const parsed = parseHttpUrl(rawUrl);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    (net.isIP(hostname) && isBlockedNetworkAddress(hostname))
  ) {
    throw new TypeError(`URL hostname is blocked: ${hostname}`);
  }
  for (const name of [...parsed.searchParams.keys()]) {
    if (SENSITIVE_QUERY_PATTERN.test(name) || TRACKING_QUERY_PATTERN.test(name)) {
      parsed.searchParams.delete(name);
    }
  }
  const fragment = parsed.hash.slice(1);
  if (fragment && /(?:^|&)(?:access[_-]?token|api[_-]?key|auth|authorization|code|credential|jwt|key|password|secret|session|signature|sig|token)=/i.test(fragment)) {
    const parameters = new URLSearchParams(fragment);
    for (const name of [...parameters.keys()]) {
      if (SENSITIVE_QUERY_PATTERN.test(name)) parameters.delete(name);
    }
    parsed.hash = parameters.size > 0 ? parameters.toString() : "";
  } else if (fragment && /(?:^|[?&/;])(?:access[_-]?token|api[_-]?key|auth|authorization|code|credential|jwt|key|password|secret|session|signature|sig|token)=/i.test(fragment)) {
    parsed.hash = "";
  }
  return parsed.toString();
}

function parseIpv4(address) {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return octets;
}

function ipv4Integer(address) {
  const octets = parseIpv4(address);
  if (!octets) return null;
  return (((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3]) >>> 0;
}

function ipv4InSubnet(address, network, prefix) {
  const value = ipv4Integer(address);
  const base = ipv4Integer(network);
  if (value === null || base === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

function isBlockedIpv4(address) {
  if (!parseIpv4(address)) return true;
  const blocked = [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
    ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
    ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
  ];
  return blocked.some(([network, prefix]) => ipv4InSubnet(address, network, prefix));
}

function expandIpv6(address) {
  let normalized = address.replace(/^\[|\]$/g, "").split("%", 1)[0].toLowerCase();
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4 = normalized.slice(lastColon + 1);
    const octets = parseIpv4(ipv4);
    if (!octets) return null;
    normalized = `${normalized.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = halves.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

function ipv6BigInt(groups) {
  return groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n);
}

function ipv6InSubnet(groups, network, prefix) {
  const networkGroups = expandIpv6(network);
  if (!networkGroups) return false;
  const shift = 128n - BigInt(prefix);
  return (ipv6BigInt(groups) >> shift) === (ipv6BigInt(networkGroups) >> shift);
}

function isBlockedIpv6(address) {
  const groups = expandIpv6(address);
  if (!groups) return true;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const mapped = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    return isBlockedIpv4(mapped);
  }
  const blocked = [
    ["::", 128], ["::1", 128], ["::", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
    ["2001::", 32], ["2001:2::", 48], ["2001:10::", 28], ["2001:20::", 28],
    ["2001:db8::", 32], ["2002::", 16], ["3ffe::", 16], ["3fff::", 20], ["5f00::", 16], ["fc00::", 7],
    ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
  ];
  return blocked.some(([network, prefix]) => ipv6InSubnet(groups, network, prefix));
}

export function isBlockedNetworkAddress(address) {
  const normalized = String(address).replace(/^\[|\]$/g, "");
  const family = net.isIP(normalized);
  if (family === 4) return isBlockedIpv4(normalized);
  if (family === 6) return isBlockedIpv6(normalized);
  return true;
}

async function defaultResolveAddresses(hostname) {
  const records = await dns.lookup(hostname, {all: true, verbatim: true});
  return records.map((record) => record.address);
}

export async function resolveSafeRemoteUrl(rawUrl, {resolveAddresses = defaultResolveAddresses} = {}) {
  const parsed = parseHttpUrl(rawUrl);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new TypeError(`URL hostname is blocked: ${hostname}`);
  }

  for (const name of parsed.searchParams.keys()) {
    if (SENSITIVE_QUERY_PATTERN.test(name)) {
      throw new TypeError(`URL contains a sensitive query parameter: ${name}`);
    }
  }

  const addresses = net.isIP(hostname) ? [hostname] : await resolveAddresses(hostname);
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new TypeError(`URL hostname did not resolve: ${hostname}`);
  }
  for (const address of addresses) {
    if (isBlockedNetworkAddress(address)) {
      throw new TypeError(`URL resolves to a blocked network address: ${address}`);
    }
  }
  return {url: parsed, addresses};
}

export async function assertSafeRemoteUrl(rawUrl, options = {}) {
  return (await resolveSafeRemoteUrl(rawUrl, options)).url;
}

export function assertSafeRelativePath(relativePath) {
  requireString(relativePath, "relative path");
  if (
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath) ||
    /^[a-zA-Z]:/.test(relativePath)
  ) {
    throw new TypeError("relative path must stay inside the output directory");
  }
  const normalized = path.posix.normalize(relativePath);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new TypeError("relative path must stay inside the output directory");
  }
  return normalized;
}

export function resolveWithin(rootPath, relativePath) {
  const safeRelativePath = assertSafeRelativePath(relativePath);
  const root = path.resolve(requireString(rootPath, "root path"));
  const resolved = path.resolve(root, safeRelativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new TypeError("resolved path escapes the output directory");
  }
  return resolved;
}

export function assertApprovedDescendant(approvedRoot, targetPath) {
  const root = path.resolve(requireString(approvedRoot, "approved root"));
  const target = path.resolve(requireString(targetPath, "target path"));
  if (root === path.parse(root).root || root === path.resolve(os.homedir())) {
    throw new TypeError("approved root cannot be a filesystem root or home directory");
  }
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new TypeError("target path must be a strict descendant of the approved root");
  }
  return target;
}

export async function assertNoSymlinkWithin(rootPath, targetPath) {
  const root = path.resolve(rootPath);
  const target = assertApprovedDescendant(root, targetPath);
  const rootMetadata = await lstat(root);
  if (rootMetadata.isSymbolicLink()) throw new TypeError("approved root cannot be a symbolic link");
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) throw new TypeError(`symbolic links are not allowed inside the approved root: ${segment}`);
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }
  return target;
}

const SECRET_PATTERNS = Object.freeze([
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["openai-key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ["bearer-jwt", /\bBearer\s+eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/i],
  ["credentialed-database-url", /\b(?:mongodb(?:\+srv)?|mysql|postgres(?:ql)?):\/\/[^\s/:@]+:[^\s/@]+@/i],
]);

export function sensitiveValueFindings(value) {
  const findings = [];
  const visit = (current, currentPath) => {
    if (typeof current === "string") {
      for (const [pattern, expression] of SECRET_PATTERNS) {
        if (expression.test(current)) findings.push({path: currentPath, pattern});
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${currentPath}[${index}]`));
      return;
    }
    if (current && typeof current === "object") {
      Object.entries(current).forEach(([key, item]) => visit(item, `${currentPath}.${key}`));
    }
  };
  visit(value, "$");
  return findings;
}

export function assertNoSensitiveValues(value) {
  const findings = sensitiveValueFindings(value);
  if (findings.length > 0) {
    const summary = findings.map(({path: itemPath, pattern}) => `${itemPath} (${pattern})`).join(", ");
    throw new TypeError(`sensitive value detected; replace it with a placeholder: ${summary}`);
  }
  return value;
}

export async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function atomicWriteFile(filePath, data, {mode = 0o600} = {}) {
  const destination = path.resolve(filePath);
  await mkdir(path.dirname(destination), {recursive: true, mode: 0o700});
  const temporary = `${destination}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, data, {flag: "wx", mode});
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
