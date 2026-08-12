import {lstat, readFile, readdir, stat} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {isDeepStrictEqual} from "node:util";

import {auditCompleteness} from "./lib/completeness.mjs";
import {assertSourceSnapshot, resolveSourceType, validateArticlePackage} from "./lib/content-model.mjs";
import {inspectImageFile} from "./lib/image-inspection.mjs";
import {renderArticleMarkdown} from "./lib/markdown.mjs";
import {renderSiteDocument, renderThemeCss} from "./lib/renderers.mjs";
import {assertApprovedDescendant, assertNoSymlinkWithin, atomicWriteFile, assertSafeRelativePath, pathExists} from "./lib/security.mjs";

const skillRoot = fileURLToPath(new URL("..", import.meta.url));
const templateRoot = path.join(skillRoot, "assets", "site-template");
const REQUIRED_FILES = ["index.html", "article.md", "content.json", "source-snapshot.json", "source-manifest.json", "completeness-report.json", "theme.css", "site.css", "print.css", "site.js"];
const MAX_TEXT_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 200 * 1024 * 1024;

function emptyMetrics() {
  return {views: 0, facts: 0, sections: 0, comicPages: 0, comicPanels: 0, comicSubtitles: 0, textCoverage: 0, sectionCoverage: 0, tableCoverage: 0, codeCoverage: 0, mediaCoverage: 0, onePageFactCoverage: 0, comicFactCoverage: 0};
}

function addError(errors, code, message) {
  errors.push({code, message});
}

function htmlTags(html) {
  return html.match(/<[^>]+>/g) ?? [];
}

function scriptErrors(html, errors) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  for (const [, attributes, content] of scripts) {
    if (!/\bsrc=["']site\.js["']/i.test(attributes) || content.trim() !== "") addError(errors, "executable-inline-script", "only the external site.js script is allowed");
  }
  const markdownTemplate = html.match(/<template\s+id=["']article-markdown["']>([\s\S]*?)<\/template>/i);
  if (!markdownTemplate) addError(errors, "missing-markdown-template", "encoded Markdown template is missing");
  else {
    try { JSON.parse(markdownTemplate[1]); } catch { addError(errors, "invalid-markdown-template", "encoded Markdown template is invalid"); }
  }
}

async function resourceErrors(html, outputPath, errors) {
  const references = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)].map((match) => match[1]);
  const sourceSets = [...html.matchAll(/\bsrcset=["']([^"']+)["']/gi)].flatMap((match) => match[1].split(",").map((item) => item.trim().split(/\s+/u, 1)[0]));
  for (const reference of [...references, ...sourceSets]) {
    if (reference.startsWith("#") || reference.startsWith("https://") || reference.startsWith("http://") || reference.startsWith("mailto:")) continue;
    let relativePath;
    try {
      relativePath = assertSafeRelativePath(reference.split("#", 1)[0].split("?", 1)[0]);
    } catch (error) {
      addError(errors, "unsafe-resource-path", `${reference}: ${error.message}`);
      continue;
    }
    if (!await pathExists(path.join(outputPath, relativePath))) addError(errors, "missing-resource", `referenced resource is missing: ${relativePath}`);
  }
}

async function listAssetFiles(root, relative = "assets") {
  const directory = path.join(root, relative);
  if (!await pathExists(directory)) return [];
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (entry.isSymbolicLink()) throw new TypeError(`asset symlink is not allowed: ${entry.name}`);
    const child = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listAssetFiles(root, child));
    else if (entry.isFile()) files.push(child);
    else throw new TypeError(`unsupported asset entry: ${child}`);
  }
  return files.sort();
}

async function verifyAssets(root, articlePackage, errors) {
  const expected = articlePackage.sourceManifest.assets.map((asset) => asset.path).sort();
  let actual;
  try { actual = await listAssetFiles(root); } catch (error) {
    addError(errors, "unsafe-asset-tree", error.message);
    return;
  }
  if (!isDeepStrictEqual(actual, expected)) addError(errors, "asset-set-mismatch", `assets must exactly match the manifest; expected ${expected.length}, found ${actual.length}`);
  let totalBytes = 0;
  for (const asset of articlePackage.sourceManifest.assets) {
    if (asset.kind === "ai-generated" && asset.generationMethod !== "native-imagegen") addError(errors, "unverified-ai-asset", `AI asset lacks native-imagegen provenance: ${asset.path}`);
    const filePath = path.join(root, asset.path);
    if (!await pathExists(filePath)) continue;
    try {
      const metadata = await lstat(filePath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new TypeError("must be a regular non-symlink file");
      if (metadata.size > MAX_ASSET_BYTES) throw new RangeError(`exceeds ${MAX_ASSET_BYTES} bytes`);
      totalBytes += metadata.size;
      if (totalBytes > MAX_TOTAL_ASSET_BYTES) throw new RangeError(`asset set exceeds ${MAX_TOTAL_ASSET_BYTES} bytes`);
      const inspection = await inspectImageFile(filePath);
      for (const field of ["format", "mimeType", "sha256", "bytes", "width", "height"]) {
        if (asset[field] !== inspection[field]) addError(errors, "asset-metadata-mismatch", `${asset.path} ${field} does not match the file`);
      }
    } catch (error) {
      addError(errors, "invalid-asset", `${asset.path}: ${error.message}`);
    }
  }
}

function comicDeliveryErrors(articlePackage, errors) {
  const comicPages = articlePackage?.comic?.pages ?? [];
  const comicPanels = articlePackage?.comic?.panels ?? [];
  const legacyPages = comicPages.filter((page) => page?.format !== "editorial");
  const editorialPages = comicPages.filter((page) => page?.format === "editorial");
  const comicSubtitles = legacyPages.flatMap((page) => page.subtitles ?? []);
  const legacyPanelCount = legacyPages.reduce((total, page) => total + (page?.panelIds?.length ?? 0), 0);
  if (comicPages.length === 0) addError(errors, "missing-comic-pages", "completed comic view must include at least one delivered comic page");
  if (comicSubtitles.length !== legacyPanelCount) addError(errors, "comic-subtitle-coverage", `legacy comic subtitles must map one-to-one to image panels (${comicSubtitles.length}/${legacyPanelCount})`);
  for (const page of editorialPages) {
    const rowPanelIds = (page?.rows ?? []).flatMap((row) => row?.panelIds ?? []);
    const expectedPanelIds = page?.panelIds ?? [];
    if (rowPanelIds.length !== expectedPanelIds.length || rowPanelIds.some((panelId, index) => panelId !== expectedPanelIds[index])) {
      addError(errors, "editorial-comic-panel-coverage", `editorial page ${page?.id ?? "unknown"} must render every panel exactly once and in order`);
    }
  }
  return {comicPages, comicPanels, comicSubtitles};
}

function compareText(actual, expected, errors, code, label) {
  if (actual !== expected) addError(errors, code, `${label} differs from the deterministic renderer output`);
}

async function readUtf8(filePath, label) {
  const metadata = await stat(filePath);
  if (!metadata.isFile() || metadata.size > MAX_TEXT_FILE_BYTES) throw new TypeError(`${label} must be a regular file no larger than ${MAX_TEXT_FILE_BYTES} bytes`);
  return readFile(filePath, "utf8");
}

export async function verifyOutput(outputPath) {
  if (typeof outputPath !== "string" || outputPath.length === 0) throw new TypeError("outputPath must be a non-empty path");
  const root = path.resolve(outputPath);
  const errors = [];
  const warnings = [];
  for (const file of REQUIRED_FILES) if (!await pathExists(path.join(root, file))) addError(errors, "missing-file", `required file is missing: ${file}`);
  if (errors.length > 0) return {ok: false, errors, warnings, metrics: emptyMetrics()};

  const [html, markdown, contentText, snapshotText, manifestText, completenessText, themeCss, siteCss, printCss, siteScript, template, templateCss, templatePrintCss, templateScript] = await Promise.all([
    readUtf8(path.join(root, "index.html"), "index.html"),
    readUtf8(path.join(root, "article.md"), "article.md"),
    readUtf8(path.join(root, "content.json"), "content.json"),
    readUtf8(path.join(root, "source-snapshot.json"), "source-snapshot.json"),
    readUtf8(path.join(root, "source-manifest.json"), "source-manifest.json"),
    readUtf8(path.join(root, "completeness-report.json"), "completeness-report.json"),
    readUtf8(path.join(root, "theme.css"), "theme.css"),
    readUtf8(path.join(root, "site.css"), "site.css"),
    readUtf8(path.join(root, "print.css"), "print.css"),
    readUtf8(path.join(root, "site.js"), "site.js"),
    readFile(path.join(templateRoot, "index.html"), "utf8"),
    readFile(path.join(templateRoot, "site.css"), "utf8"),
    readFile(path.join(templateRoot, "print.css"), "utf8"),
    readFile(path.join(templateRoot, "site.js"), "utf8"),
  ]);

  const tags = htmlTags(html);
  if (tags.some((tag) => /\son[a-z]+\s*=/i.test(tag))) addError(errors, "event-handler", "inline event handler attributes are not allowed");
  if (tags.some((tag) => /\sstyle\s*=/i.test(tag))) addError(errors, "inline-style", "inline style attributes are not allowed");
  if (tags.some((tag) => /(?:javascript|vbscript|data\s*:\s*text\/html)\s*:/i.test(tag))) addError(errors, "dangerous-scheme", "dangerous URL schemes are not allowed");
  if (tags.some((tag) => /^<(?:iframe|object|embed|form|base)\b/i.test(tag))) addError(errors, "dangerous-element", "iframe, object, embed, form, and base elements are not allowed");
  if (tags.some((tag) => /^<img\b/i.test(tag) && /\b(?:src|srcset)=["']https?:\/\//i.test(tag))) addError(errors, "remote-image", "remote images must be downloaded before build");
  if (!/<meta\s+http-equiv=["']Content-Security-Policy["']/i.test(html)) addError(errors, "missing-csp", "a restrictive Content Security Policy is required");
  if (!/<main\b/i.test(html) || !/<h1\b/i.test(html) || !/<nav\b/i.test(html)) addError(errors, "missing-landmark", "main, navigation, and heading landmarks are required");
  if (/class=["'][^"']*(?:fact-chip|fact-links|fact-list|fact-id|evidence-rail)[^"']*["']/i.test(html) || /Evidence spine|事实沿线/i.test(html)) {
    addError(errors, "consumer-provenance-ui", "internal fact IDs and the evidence rail must not be exposed in consumer HTML");
  }
  if (tags.some((tag) => /^<img\b/i.test(tag) && !/\balt=["'][^"']*["']/i.test(tag))) addError(errors, "missing-alt", "every image must include alt text");
  if (/(?:@import\s+|url\(\s*["']?\s*(?:https?:|\/\/|data:text\/html))/i.test(`${themeCss}\n${siteCss}\n${printCss}`)) addError(errors, "remote-css-resource", "CSS must not import remote or active content");
  scriptErrors(html, errors);
  await resourceErrors(html, root, errors);

  let articlePackage;
  let sourceSnapshot;
  let sourceManifest;
  let storedCompleteness;
  let comicMetrics = {comicPages: [], comicPanels: [], comicSubtitles: []};
  try {
    articlePackage = JSON.parse(contentText);
    for (const error of validateArticlePackage(articlePackage)) addError(errors, "invalid-content", `${error.path}: ${error.message}`);
    comicMetrics = comicDeliveryErrors(articlePackage, errors);
  } catch (error) { addError(errors, "invalid-content-json", error.message); }
  try { sourceSnapshot = JSON.parse(snapshotText); assertSourceSnapshot(sourceSnapshot); } catch (error) { addError(errors, "invalid-source-snapshot", error.message); }
  try { sourceManifest = JSON.parse(manifestText); } catch (error) { addError(errors, "invalid-source-manifest", error.message); }
  try { storedCompleteness = JSON.parse(completenessText); } catch (error) { addError(errors, "invalid-completeness-report", error.message); }

  if (articlePackage && sourceSnapshot) {
    const expectedMarkdown = renderArticleMarkdown(articlePackage);
    compareText(markdown, expectedMarkdown, errors, "stale-markdown", "article.md");
    if (articlePackage.markdown !== expectedMarkdown) addError(errors, "stale-content-markdown", "content.json markdown differs from the deterministic renderer output");
    compareText(themeCss, renderThemeCss(articlePackage), errors, "stale-theme", "theme.css");
    compareText(html, renderSiteDocument(articlePackage, template), errors, "stale-html", "index.html");
    const recomputed = auditCompleteness(sourceSnapshot, articlePackage);
    if (!isDeepStrictEqual(storedCompleteness, recomputed)) addError(errors, "stale-completeness-report", "completeness report differs from a fresh audit");
    if (!recomputed.ok || recomputed.missing.length > 0) addError(errors, "content-incomplete", "fresh completeness audit did not reach 100% with zero missing items");
    const articleSourceType = resolveSourceType(articlePackage.article.source);
    const manifestSourceType = resolveSourceType(articlePackage.sourceManifest);
    const snapshotSourceType = resolveSourceType(sourceSnapshot);
    if (articleSourceType !== manifestSourceType || articleSourceType !== snapshotSourceType) {
      addError(errors, "source-type-mismatch", "article, manifest, and source snapshot sourceType values must match exactly");
    } else if (articleSourceType === "public-url" && (articlePackage.article.source.url !== sourceSnapshot.canonicalUrl || articlePackage.sourceManifest.originalUrl !== sourceSnapshot.canonicalUrl)) {
      addError(errors, "source-url-mismatch", "article, manifest, and source snapshot URLs must match exactly");
    } else if (articleSourceType === "pasted-text" && (articlePackage.article.source.name !== sourceSnapshot.sourceName || articlePackage.sourceManifest.sourceName !== sourceSnapshot.sourceName)) {
      addError(errors, "source-name-mismatch", "article, manifest, and pasted-text source snapshot names must match exactly");
    }
    await verifyAssets(root, articlePackage, errors);
  }
  if (articlePackage && sourceManifest && !isDeepStrictEqual(sourceManifest, articlePackage.sourceManifest)) addError(errors, "stale-source-manifest", "source-manifest.json differs from content.json");
  compareText(siteCss, templateCss, errors, "modified-template", "site.css");
  compareText(printCss, templatePrintCss, errors, "modified-template", "print.css");
  compareText(siteScript, templateScript, errors, "modified-template", "site.js");

  const views = (html.match(/\bdata-view=["'][^"']+["']/g) ?? []).length;
  if (views !== 3) addError(errors, "view-count", `expected 3 view panels, found ${views}`);
  const freshMetrics = articlePackage && sourceSnapshot ? auditCompleteness(sourceSnapshot, articlePackage).metrics : {};
  const metrics = {
    views,
    facts: articlePackage?.facts?.length ?? 0,
    sections: articlePackage?.article?.sections?.length ?? 0,
    comicPages: comicMetrics.comicPages.length,
    comicPanels: comicMetrics.comicPanels.length,
    comicSubtitles: comicMetrics.comicSubtitles.length,
    textCoverage: freshMetrics.textCoverage ?? 0,
    sectionCoverage: freshMetrics.sectionCoverage ?? 0,
    tableCoverage: freshMetrics.tableCoverage ?? 0,
    codeCoverage: freshMetrics.codeCoverage ?? 0,
    mediaCoverage: freshMetrics.mediaCoverage ?? 0,
    onePageFactCoverage: freshMetrics.onePageFactCoverage ?? 0,
    comicFactCoverage: freshMetrics.comicFactCoverage ?? 0,
  };
  if (metrics.facts === 0) warnings.push({code: "no-facts", message: "the fact ledger is empty"});
  return {ok: errors.length === 0, errors, warnings, metrics};
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new TypeError("Usage: node verify-output.mjs --approved-root <directory> --output <output-directory>");
    result[flag.slice(2)] = value;
  }
  return result;
}

async function main(argv) {
  const args = parseArgs(argv);
  const root = assertApprovedDescendant(path.resolve(args["approved-root"]), path.resolve(args.output));
  await assertNoSymlinkWithin(path.resolve(args["approved-root"]), root);
  const report = await verifyOutput(root);
  await atomicWriteFile(path.join(root, "verification-report.json"), `${JSON.stringify(report, null, 2)}\n`, {mode: 0o644});
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
