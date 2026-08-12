import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildSite } from "../build-site.mjs";
import { verifyOutput } from "../verify-output.mjs";

const fixtureUrl = new URL("./fixtures/article-package.json", import.meta.url);
const snapshotUrl = new URL("./fixtures/source-snapshot.json", import.meta.url);

async function writePastedTextInput(root) {
  const inputRoot = path.join(root, "input");
  const fixtureComicUrl = new URL("./fixtures/assets/comic/test-comic.png", import.meta.url);
  await mkdir(path.join(inputRoot, "assets", "comic"), {recursive: true});
  const articlePackage = JSON.parse(await readFile(fixtureUrl, "utf8"));
  articlePackage.article.source = {sourceType: "pasted-text", name: "用户提供原文", verified: false};
  articlePackage.facts = articlePackage.facts.map(({sourceUrl, ...fact}) => ({...fact, sourceRef: "source-snapshot"}));
  articlePackage.sourceManifest = {
    sourceType: "pasted-text",
    sourceName: "用户提供原文",
    capturedAt: articlePackage.sourceManifest.capturedAt,
    assets: articlePackage.sourceManifest.assets,
  };
  const snapshot = JSON.parse(await readFile(snapshotUrl, "utf8"));
  delete snapshot.canonicalUrl;
  snapshot.sourceType = "pasted-text";
  snapshot.sourceName = "用户提供原文";
  const packagePath = path.join(inputRoot, "article-package.json");
  const sourceSnapshotPath = path.join(inputRoot, "source-snapshot.json");
  await writeFile(packagePath, JSON.stringify(articlePackage), "utf8");
  await writeFile(sourceSnapshotPath, JSON.stringify(snapshot), "utf8");
  await writeFile(path.join(inputRoot, "assets", "comic", "test-comic.png"), await readFile(fixtureComicUrl));
  return {packagePath, sourceSnapshotPath};
}

async function writeEditorialInput(root) {
  const inputRoot = path.join(root, "editorial-input");
  await mkdir(inputRoot, {recursive: true});
  const articlePackage = JSON.parse(await readFile(fixtureUrl, "utf8"));
  articlePackage.comic.panels[0].display = {
    kind: "takeaway",
    tone: "halftone",
    text: "错误必须回到修复循环。",
    detail: "测试与回退构成可验证的交付。",
    mark: "終",
  };
  articlePackage.comic.pages[0] = {
    id: "comic-page-1",
    format: "editorial",
    number: "01/01",
    caption: "编辑漫画也必须覆盖事实。",
    factIds: ["fact-1"],
    panelIds: ["panel-1"],
    rows: [{layout: "single", panelIds: ["panel-1"]}],
  };
  articlePackage.sourceManifest.assets = [];
  const packagePath = path.join(inputRoot, "article-package.json");
  await writeFile(packagePath, JSON.stringify(articlePackage), "utf8");
  return packagePath;
}

test("accepts a clean generated site", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-verify-"));
  const outputPath = path.join(root, "site");
  try {
    await buildSite({inputPath: fixtureUrl, sourceSnapshotPath: snapshotUrl, approvedOutputRoot: root, outputPath});
    const report = await verifyOutput(outputPath);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.equal(report.metrics.views, 3);
    assert.equal(report.metrics.textCoverage, 1);
    assert.equal(report.metrics.onePageFactCoverage, 1);
    assert.equal(report.metrics.comicFactCoverage, 1);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("accepts a clean editorial comic without bitmap assets or subtitles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-verify-editorial-"));
  const outputPath = path.join(root, "site");
  try {
    const packagePath = await writeEditorialInput(root);
    await buildSite({inputPath: packagePath, sourceSnapshotPath: snapshotUrl, approvedOutputRoot: root, outputPath});
    const report = await verifyOutput(outputPath);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.equal(report.metrics.comicPages, 1);
    assert.equal(report.metrics.comicPanels, 1);
    assert.equal(report.metrics.comicSubtitles, 0);
    assert.equal(report.metrics.comicFactCoverage, 1);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("accepts complete-expansion output only when both summary views cover every fact", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-verify-expanded-"));
  const inputRoot = path.join(root, "input");
  const outputPath = path.join(root, "site");
  try {
    const articlePackage = JSON.parse(await readFile(fixtureUrl, "utf8"));
    articlePackage.delivery = {expansionMode: "complete"};
    await mkdir(path.join(inputRoot, "assets", "comic"), {recursive: true});
    await writeFile(path.join(inputRoot, "article-package.json"), JSON.stringify(articlePackage), "utf8");
    await writeFile(
      path.join(inputRoot, "assets", "comic", "test-comic.png"),
      await readFile(new URL("./fixtures/assets/comic/test-comic.png", import.meta.url)),
    );
    await buildSite({
      inputPath: path.join(inputRoot, "article-package.json"),
      sourceSnapshotPath: snapshotUrl,
      approvedOutputRoot: root,
      outputPath,
    });
    const report = await verifyOutput(outputPath);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.equal(report.metrics.onePageFactCoverage, 1);
    assert.equal(report.metrics.comicFactCoverage, 1);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("accepts a clean pasted-text site without URL equality checks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-verify-pasted-"));
  const outputPath = path.join(root, "site");
  try {
    const {packagePath, sourceSnapshotPath} = await writePastedTextInput(root);
    await buildSite({inputPath: packagePath, sourceSnapshotPath, approvedOutputRoot: root, outputPath});
    const report = await verifyOutput(outputPath);
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.equal(report.metrics.textCoverage, 1);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("detects event handlers and dangerous URL schemes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-verify-"));
  const outputPath = path.join(root, "site");
  try {
    await buildSite({inputPath: fixtureUrl, sourceSnapshotPath: snapshotUrl, approvedOutputRoot: root, outputPath});
    const indexPath = path.join(outputPath, "index.html");
    const html = await readFile(indexPath, "utf8");
    await writeFile(indexPath, html.replace("<main", "<main onclick=\"alert(1)\" data-url=\"javascript:alert(1)\""), "utf8");
    const report = await verifyOutput(outputPath);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.code === "event-handler"));
    assert.ok(report.errors.some((error) => error.code === "dangerous-scheme"));
    assert.ok(report.errors.some((error) => error.code === "stale-html"));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects stale Markdown and remote CSS imports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-verify-rendered-"));
  const outputPath = path.join(root, "site");
  try {
    await buildSite({inputPath: fixtureUrl, sourceSnapshotPath: snapshotUrl, approvedOutputRoot: root, outputPath});
    await writeFile(path.join(outputPath, "article.md"), "# stale\n", "utf8");
    const cssPath = path.join(outputPath, "site.css");
    await writeFile(cssPath, `${await readFile(cssPath, "utf8")}\n@import url(https://evil.example/x.css);\n`, "utf8");
    const report = await verifyOutput(outputPath);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.code === "stale-markdown"));
    assert.ok(report.errors.some((error) => error.code === "remote-css-resource"));
    assert.ok(report.errors.some((error) => error.code === "modified-template"));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects output without a clean completeness report", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-verify-completeness-"));
  const outputPath = path.join(root, "site");
  try {
    await buildSite({inputPath: fixtureUrl, sourceSnapshotPath: snapshotUrl, approvedOutputRoot: root, outputPath});
    await unlink(path.join(outputPath, "completeness-report.json"));
    const report = await verifyOutput(outputPath);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.code === "missing-file"));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects stale completeness reports and tampered local assets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-verify-stale-"));
  const outputPath = path.join(root, "site");
  try {
    await buildSite({inputPath: fixtureUrl, sourceSnapshotPath: snapshotUrl, approvedOutputRoot: root, outputPath});
    const reportPath = path.join(outputPath, "completeness-report.json");
    const stored = JSON.parse(await readFile(reportPath, "utf8"));
    stored.metrics.textCoverage = 0.5;
    await writeFile(reportPath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
    const imagePath = path.join(outputPath, "assets", "comic", "test-comic.png");
    const bytes = await readFile(imagePath);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(imagePath, bytes);

    const report = await verifyOutput(outputPath);
    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.code === "stale-completeness-report"));
    assert.ok(report.errors.some((error) => error.code === "asset-metadata-mismatch"));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects a storyboard-only comic delivery", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-verify-comic-images-"));
  const outputPath = path.join(root, "site");
  try {
    await buildSite({inputPath: fixtureUrl, sourceSnapshotPath: snapshotUrl, approvedOutputRoot: root, outputPath});
    const contentPath = path.join(outputPath, "content.json");
    const content = JSON.parse(await readFile(contentPath, "utf8"));
    content.comic.pages = [];
    await writeFile(contentPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");

    const report = await verifyOutput(outputPath);

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.code === "missing-comic-pages"));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects comic pages without complete HTML subtitle coverage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-verify-comic-subtitles-"));
  const outputPath = path.join(root, "site");
  try {
    await buildSite({inputPath: fixtureUrl, sourceSnapshotPath: snapshotUrl, approvedOutputRoot: root, outputPath});
    const contentPath = path.join(outputPath, "content.json");
    const content = JSON.parse(await readFile(contentPath, "utf8"));
    delete content.comic.pages[0].subtitles;
    await writeFile(contentPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");

    const report = await verifyOutput(outputPath);

    assert.equal(report.ok, false);
    assert.ok(report.errors.some((error) => error.code === "comic-subtitle-coverage"));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
