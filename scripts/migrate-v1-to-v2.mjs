import {mkdir, readFile, stat} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";

import {assertArticlePackage, assertSourceSnapshot, CONTENT_VERSION} from "./lib/content-model.mjs";
import {renderArticleMarkdown} from "./lib/markdown.mjs";
import {assertApprovedDescendant, assertNoSymlinkWithin, atomicWriteFile, pathExists} from "./lib/security.mjs";

const MAX_JSON_BYTES = 25 * 1024 * 1024;

function slugify(value, fallback) {
  const result = String(value ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  return result || fallback;
}

function uniqueId(candidate, used) {
  let value = candidate;
  let counter = 2;
  while (used.has(value)) value = `${candidate}-${counter++}`;
  used.add(value);
  return value;
}

function factIdsOrFallback(value, knownFactIds, warnings, pathLabel) {
  const valid = Array.isArray(value) ? [...new Set(value.filter((factId) => knownFactIds.includes(factId)))] : [];
  if (valid.length > 0) return valid;
  warnings.push(`${pathLabel}: v1 had no explicit fact mapping; all known facts were conservatively attached for manual review`);
  return [...knownFactIds];
}

export function migrateSourceSnapshotV1(input) {
  if (!input || typeof input !== "object" || input.version !== 1) throw new TypeError("source snapshot must use version 1");
  const used = new Set();
  const migrated = structuredClone(input);
  migrated.version = CONTENT_VERSION;
  migrated.sections = migrated.sections.map((section, index) => ({
    ...section,
    id: uniqueId(slugify(section.id ?? section.title, `section-${index + 1}`), used),
  }));
  assertSourceSnapshot(migrated);
  return migrated;
}

export function migrateArticlePackageV1(input) {
  if (!input || typeof input !== "object" || input.version !== 1) throw new TypeError("article package must use version 1");
  const migrated = structuredClone(input);
  const warnings = [];
  const knownFactIds = (migrated.facts ?? []).map((fact) => fact.id);
  if (knownFactIds.length === 0) throw new TypeError("v1 package must contain at least one fact before strict migration");
  migrated.version = CONTENT_VERSION;
  migrated.onePage.metrics = migrated.onePage.metrics.map((metric, index) => ({
    ...metric,
    factIds: factIdsOrFallback(metric.factIds, knownFactIds, warnings, `onePage.metrics[${index}]`),
  }));
  migrated.onePage.modules = migrated.onePage.modules.map((module, moduleIndex) => ({
    ...module,
    items: module.items.map((item, itemIndex) => ({
      ...item,
      factIds: factIdsOrFallback(item.factIds, knownFactIds, warnings, `onePage.modules[${moduleIndex}].items[${itemIndex}]`),
    })),
  }));
  migrated.comic.panels = migrated.comic.panels.map((panel, index) => ({
    ...panel,
    factIds: factIdsOrFallback(panel.factIds, knownFactIds, warnings, `comic.panels[${index}]`),
  }));
  const subtitleCount = migrated.comic.pages.reduce((total, page) => total + (page.subtitles?.length ?? 0), 0);
  if (subtitleCount !== migrated.comic.panels.length) {
    throw new TypeError(`cannot infer exact comic mapping: ${subtitleCount} subtitles for ${migrated.comic.panels.length} panels`);
  }
  let panelCursor = 0;
  migrated.comic.pages = migrated.comic.pages.map((page, pageIndex) => {
    const panelIds = migrated.comic.panels.slice(panelCursor, panelCursor + page.subtitles.length).map((panel) => panel.id);
    const subtitles = page.subtitles.map((subtitle, subtitleIndex) => {
      const panel = migrated.comic.panels[panelCursor + subtitleIndex];
      const subtitleFactIds = factIdsOrFallback(subtitle.factIds, knownFactIds, warnings, `comic.pages[${pageIndex}].subtitles[${subtitleIndex}]`);
      return {
        ...subtitle,
        panelId: panel.id,
        factIds: [...new Set([...subtitleFactIds, ...panel.factIds])],
      };
    });
    const pageFactIds = factIdsOrFallback(page.factIds, knownFactIds, warnings, `comic.pages[${pageIndex}]`);
    const panelFactIds = migrated.comic.panels.slice(panelCursor, panelCursor + page.subtitles.length).flatMap((panel) => panel.factIds);
    panelCursor += page.subtitles.length;
    return {
      ...page,
      panelIds,
      subtitles,
      factIds: [...new Set([...pageFactIds, ...panelFactIds])],
    };
  });
  migrated.sourceManifest.assets = migrated.sourceManifest.assets.map((asset) => ({
    ...asset,
    capturedAt: asset.capturedAt ?? migrated.sourceManifest.capturedAt ?? migrated.generatedAt,
    purpose: asset.purpose ?? `Migrated visual asset: ${asset.path}`,
    ...(asset.kind === "original" ? {sourceUrl: asset.sourceUrl ?? migrated.sourceManifest.originalUrl} : {}),
    ...(asset.kind === "ai-generated" ? {
      generationMethod: asset.generationMethod ?? "legacy-unverified",
      createdFor: migrated.article.slug,
    } : {}),
  }));
  migrated.migration = {
    fromVersion: 1,
    migratedAt: migrated.generatedAt,
    warnings,
    requiresManualReview: warnings.length > 0 || migrated.sourceManifest.assets.some((asset) => asset.generationMethod === "legacy-unverified"),
  };
  migrated.markdown = renderArticleMarkdown(migrated);
  assertArticlePackage(migrated);
  return migrated;
}

async function readJson(filePath, label) {
  const metadata = await stat(filePath);
  if (!metadata.isFile() || metadata.size > MAX_JSON_BYTES) throw new TypeError(`${label} must be a regular JSON file no larger than ${MAX_JSON_BYTES} bytes`);
  return JSON.parse(await readFile(filePath, "utf8"));
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new TypeError("Usage: node migrate-v1-to-v2.mjs --input <v1-package.json> --source-snapshot <v1-snapshot.json> --approved-root <directory> --output <directory>");
    result[flag.slice(2)] = value;
  }
  return result;
}

async function main(argv) {
  const args = parseArgs(argv);
  const approvedRoot = path.resolve(args["approved-root"]);
  const output = assertApprovedDescendant(approvedRoot, path.resolve(args.output));
  await assertNoSymlinkWithin(approvedRoot, output);
  const packagePath = path.join(output, "article-package-v2.json");
  const snapshotPath = path.join(output, "source-snapshot-v2.json");
  if (await pathExists(packagePath) || await pathExists(snapshotPath)) throw new Error("migration output already exists; choose a new output directory");
  const [articlePackage, sourceSnapshot] = await Promise.all([
    readJson(path.resolve(args.input), "article package"),
    readJson(path.resolve(args["source-snapshot"]), "source snapshot"),
  ]);
  const migratedPackage = migrateArticlePackageV1(articlePackage);
  const migratedSnapshot = migrateSourceSnapshotV1(sourceSnapshot);
  await mkdir(output, {recursive: true, mode: 0o700});
  await Promise.all([
    atomicWriteFile(packagePath, `${JSON.stringify(migratedPackage, null, 2)}\n`, {mode: 0o600}),
    atomicWriteFile(snapshotPath, `${JSON.stringify(migratedSnapshot, null, 2)}\n`, {mode: 0o600}),
  ]);
  process.stdout.write(`${JSON.stringify({packagePath, snapshotPath, warnings: migratedPackage.migration.warnings}, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
