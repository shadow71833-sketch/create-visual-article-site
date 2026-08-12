import {copyFile, lstat, mkdir, readFile, rename, rm, stat} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {randomUUID} from "node:crypto";

import {assertArticlePackage, assertSourceSnapshot, resolveSourceType} from "./lib/content-model.mjs";
import {auditCompleteness} from "./lib/completeness.mjs";
import {inspectImageFile} from "./lib/image-inspection.mjs";
import {renderArticleMarkdown} from "./lib/markdown.mjs";
import {renderSiteDocument, renderThemeCss} from "./lib/renderers.mjs";
import {
  assertApprovedDescendant,
  assertNoSensitiveValues,
  assertNoSymlinkWithin,
  atomicWriteFile,
  pathExists,
  resolveWithin,
  sanitizePublicUrl,
} from "./lib/security.mjs";

const skillRoot = fileURLToPath(new URL("..", import.meta.url));
const templateRoot = path.join(skillRoot, "assets", "site-template");
const MAX_JSON_BYTES = 25 * 1024 * 1024;
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 200 * 1024 * 1024;
const MAX_ASSET_COUNT = 100;

function inputPathFrom(value, label = "inputPath") {
  if (value instanceof URL) {
    if (value.protocol !== "file:") throw new TypeError(`${label} URL must use file:`);
    return fileURLToPath(value);
  }
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a path or file URL`);
  return path.resolve(value);
}

async function readJsonFile(filePath, label) {
  const metadata = await stat(filePath);
  if (!metadata.isFile()) throw new TypeError(`${label} must be a regular file`);
  if (metadata.size > MAX_JSON_BYTES) throw new RangeError(`${label} exceeds ${MAX_JSON_BYTES} bytes`);
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new TypeError(`${label} is not valid JSON: ${error.message}`);
  }
}

function sanitizePackage(input) {
  const value = structuredClone(input);
  const sourceType = resolveSourceType(value.article.source);
  if (sourceType === "public-url") value.article.source.url = sanitizePublicUrl(value.article.source.url);
  value.article.sections = value.article.sections.map((section) => ({
    ...section,
    blocks: section.blocks.map((block) => block.type === "media-link"
      ? {...block, url: sanitizePublicUrl(block.url)}
      : block),
  }));
  value.facts = value.facts.map((fact) => sourceType === "public-url"
    ? {...fact, sourceUrl: sanitizePublicUrl(fact.sourceUrl)}
    : fact);
  if (sourceType === "public-url") value.sourceManifest.originalUrl = sanitizePublicUrl(value.sourceManifest.originalUrl);
  value.sourceManifest.assets = value.sourceManifest.assets.map((asset) => ({
    ...asset,
    ...(typeof asset.sourceUrl === "string" ? {sourceUrl: sanitizePublicUrl(asset.sourceUrl)} : {}),
  }));
  return value;
}

function sanitizeSourceSnapshot(input) {
  const value = structuredClone(input);
  if (resolveSourceType(value) === "public-url") value.canonicalUrl = sanitizePublicUrl(value.canonicalUrl);
  value.sections = value.sections.map((section) => ({
    ...section,
    blocks: section.blocks.map((block) => block.type === "media-link"
      ? {...block, url: sanitizePublicUrl(block.url)}
      : block),
  }));
  return value;
}

async function copyReferencedAssets(articlePackage, inputDirectory, stagingPath) {
  const assets = articlePackage.sourceManifest.assets;
  if (assets.length > MAX_ASSET_COUNT) throw new RangeError(`asset manifest exceeds ${MAX_ASSET_COUNT} files`);
  let totalBytes = 0;
  const enrichedAssets = [];
  for (const asset of assets) {
    if (asset.kind === "ai-generated" && asset.generationMethod !== "native-imagegen") {
      throw new TypeError(`AI asset provenance is not verified: ${asset.path}`);
    }
    const source = resolveWithin(inputDirectory, asset.path);
    await assertNoSymlinkWithin(inputDirectory, source);
    const metadata = await lstat(source);
    if (!metadata.isFile()) throw new TypeError(`asset must be a regular file: ${asset.path}`);
    if (metadata.size > MAX_ASSET_BYTES) throw new RangeError(`asset exceeds ${MAX_ASSET_BYTES} bytes: ${asset.path}`);
    totalBytes += metadata.size;
    if (totalBytes > MAX_TOTAL_ASSET_BYTES) throw new RangeError(`assets exceed ${MAX_TOTAL_ASSET_BYTES} total bytes`);
    const inspection = await inspectImageFile(source);
    const destination = resolveWithin(stagingPath, asset.path);
    await mkdir(path.dirname(destination), {recursive: true, mode: 0o755});
    await copyFile(source, destination, 0);
    enrichedAssets.push({...asset, ...inspection});
  }
  articlePackage.sourceManifest.assets = enrichedAssets;
}

function timestampForPath(date) {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function uniqueBackupPath(outputPath, date) {
  const base = `${outputPath}.backup-${timestampForPath(date)}`;
  if (!await pathExists(base)) return base;
  return `${base}-${randomUUID().slice(0, 8)}`;
}

export async function buildSite({inputPath, sourceSnapshotPath, approvedOutputRoot, outputPath, now = () => new Date()} = {}) {
  const resolvedInput = inputPathFrom(inputPath);
  const resolvedSourceSnapshot = inputPathFrom(sourceSnapshotPath, "sourceSnapshotPath");
  const resolvedApprovedRoot = inputPathFrom(approvedOutputRoot, "approvedOutputRoot");
  const resolvedOutput = assertApprovedDescendant(resolvedApprovedRoot, inputPathFrom(outputPath, "outputPath"));
  await assertNoSymlinkWithin(resolvedApprovedRoot, resolvedOutput);

  const [rawPackage, rawSourceSnapshot] = await Promise.all([
    readJsonFile(resolvedInput, "article package"),
    readJsonFile(resolvedSourceSnapshot, "source snapshot"),
  ]);
  assertNoSensitiveValues(rawPackage);
  assertNoSensitiveValues(rawSourceSnapshot);
  assertArticlePackage(rawPackage);
  assertSourceSnapshot(rawSourceSnapshot);
  const articlePackage = sanitizePackage(rawPackage);
  const sourceSnapshot = sanitizeSourceSnapshot(rawSourceSnapshot);
  const articleSourceType = resolveSourceType(articlePackage.article.source);
  const manifestSourceType = resolveSourceType(articlePackage.sourceManifest);
  const snapshotSourceType = resolveSourceType(sourceSnapshot);
  if (articleSourceType !== manifestSourceType || articleSourceType !== snapshotSourceType) {
    throw new TypeError("article, source manifest, and source snapshot sourceType values must match exactly");
  }
  if (articleSourceType === "public-url" && (articlePackage.article.source.url !== sourceSnapshot.canonicalUrl || articlePackage.sourceManifest.originalUrl !== sourceSnapshot.canonicalUrl)) {
    throw new TypeError("article source URL and source manifest URL must exactly match sourceSnapshot.canonicalUrl after sanitization");
  }
  if (articleSourceType === "pasted-text" && (articlePackage.article.source.name !== sourceSnapshot.sourceName || articlePackage.sourceManifest.sourceName !== sourceSnapshot.sourceName)) {
    throw new TypeError("article, source manifest, and pasted-text source snapshot names must match exactly");
  }
  articlePackage.markdown = renderArticleMarkdown(articlePackage);
  assertArticlePackage(articlePackage);
  const completenessReport = auditCompleteness(sourceSnapshot, articlePackage);
  if (!completenessReport.ok) {
    const details = [...completenessReport.errors.map(({code, message}) => `${code}: ${message}`), ...completenessReport.missing.map((item) => `${item.path}: ${item.text ?? item.title ?? item.type}`)].join("\n");
    throw new TypeError(`Content completeness gate failed:\n${details}`);
  }

  const stagingPath = `${resolvedOutput}.build-${randomUUID()}`;
  assertApprovedDescendant(resolvedApprovedRoot, stagingPath);
  await mkdir(stagingPath, {recursive: false, mode: 0o755});
  let backupPath = null;
  try {
    await copyReferencedAssets(articlePackage, path.dirname(resolvedInput), stagingPath);
    assertArticlePackage(articlePackage);
    const [template, css, printCss, script] = await Promise.all([
      readFile(path.join(templateRoot, "index.html"), "utf8"),
      readFile(path.join(templateRoot, "site.css"), "utf8"),
      readFile(path.join(templateRoot, "print.css"), "utf8"),
      readFile(path.join(templateRoot, "site.js"), "utf8"),
    ]);
    const html = renderSiteDocument(articlePackage, template);
    await Promise.all([
      atomicWriteFile(path.join(stagingPath, "index.html"), html, {mode: 0o644}),
      atomicWriteFile(path.join(stagingPath, "theme.css"), renderThemeCss(articlePackage), {mode: 0o644}),
      atomicWriteFile(path.join(stagingPath, "site.css"), css, {mode: 0o644}),
      atomicWriteFile(path.join(stagingPath, "print.css"), printCss, {mode: 0o644}),
      atomicWriteFile(path.join(stagingPath, "site.js"), script, {mode: 0o644}),
      atomicWriteFile(path.join(stagingPath, "article.md"), articlePackage.markdown, {mode: 0o644}),
      atomicWriteFile(path.join(stagingPath, "content.json"), `${JSON.stringify(articlePackage, null, 2)}\n`, {mode: 0o644}),
      atomicWriteFile(path.join(stagingPath, "source-snapshot.json"), `${JSON.stringify(sourceSnapshot, null, 2)}\n`, {mode: 0o644}),
      atomicWriteFile(path.join(stagingPath, "source-manifest.json"), `${JSON.stringify(articlePackage.sourceManifest, null, 2)}\n`, {mode: 0o644}),
      atomicWriteFile(path.join(stagingPath, "completeness-report.json"), `${JSON.stringify(completenessReport, null, 2)}\n`, {mode: 0o644}),
    ]);

    if (await pathExists(resolvedOutput)) {
      backupPath = await uniqueBackupPath(resolvedOutput, now());
      assertApprovedDescendant(resolvedApprovedRoot, backupPath);
      await rename(resolvedOutput, backupPath);
    }
    try {
      await rename(stagingPath, resolvedOutput);
    } catch (error) {
      if (backupPath && !await pathExists(resolvedOutput)) await rename(backupPath, resolvedOutput);
      throw error;
    }
    return {outputPath: resolvedOutput, backupPath, articleSlug: articlePackage.article.slug};
  } catch (error) {
    await rm(stagingPath, {recursive: true, force: true}).catch(() => {});
    throw error;
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new TypeError("Usage: node build-site.mjs --input <package.json> --source-snapshot <source-snapshot.json> --approved-root <directory> --output <directory>");
    result[flag.slice(2)] = value;
  }
  return result;
}

async function main(argv) {
  const args = parseArgs(argv);
  const result = await buildSite({inputPath: args.input, sourceSnapshotPath: args["source-snapshot"], approvedOutputRoot: args["approved-root"], outputPath: args.output});
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
