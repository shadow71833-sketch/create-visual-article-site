import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildSite } from "../build-site.mjs";

const fixtureUrl = new URL("./fixtures/article-package.json", import.meta.url);
const snapshotUrl = new URL("./fixtures/source-snapshot.json", import.meta.url);
const fixtureComicUrl = new URL("./fixtures/assets/comic/test-comic.png", import.meta.url);

async function writePastedTextInput(root) {
  const inputRoot = path.join(root, "input");
  await mkdir(path.join(inputRoot, "assets", "comic"), {recursive: true});
  const articlePackage = JSON.parse(await readFile(fixtureUrl, "utf8"));
  articlePackage.article.source = {
    sourceType: "pasted-text",
    name: "用户提供原文",
    verified: false,
  };
  articlePackage.facts = articlePackage.facts.map(({sourceUrl, ...fact}) => ({...fact, sourceRef: "source-snapshot"}));
  articlePackage.sourceManifest = {
    sourceType: "pasted-text",
    sourceName: "用户提供原文",
    capturedAt: articlePackage.sourceManifest.capturedAt,
    assets: articlePackage.sourceManifest.assets,
  };
  const sourceSnapshot = JSON.parse(await readFile(snapshotUrl, "utf8"));
  delete sourceSnapshot.canonicalUrl;
  sourceSnapshot.sourceType = "pasted-text";
  sourceSnapshot.sourceName = "用户提供原文";
  const packagePath = path.join(inputRoot, "article-package.json");
  const sourceSnapshotPath = path.join(inputRoot, "source-snapshot.json");
  await writeFile(packagePath, JSON.stringify(articlePackage), "utf8");
  await writeFile(sourceSnapshotPath, JSON.stringify(sourceSnapshot), "utf8");
  await writeFile(path.join(inputRoot, "assets", "comic", "test-comic.png"), await readFile(fixtureComicUrl));
  return {packagePath, sourceSnapshotPath};
}

test("builds an offline three-view site and escapes hostile content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-build-"));
  const outputPath = path.join(root, "site");
  try {
    const result = await buildSite({
      inputPath: fixtureUrl,
      sourceSnapshotPath: snapshotUrl,
      approvedOutputRoot: root,
      outputPath,
      now: () => new Date("2026-08-10T00:00:00.000Z"),
    });
    assert.equal(result.outputPath, outputPath);
    for (const file of ["index.html", "article.md", "content.json", "source-snapshot.json", "source-manifest.json", "completeness-report.json", "theme.css", "site.css", "print.css", "site.js"]) {
      await access(path.join(outputPath, file));
    }
    const html = await readFile(path.join(outputPath, "index.html"), "utf8");
    assert.match(html, /data-view="article"/);
    assert.match(html, /data-view="one-page"/);
    assert.match(html, /data-view="comic"/);
    assert.match(html, /data-module="timeline"/);
    assert.match(html, /data-module="risks"/);
    assert.doesNotMatch(html, /class="[^"]*(?:fact-chip|fact-links|fact-list|fact-id|evidence-rail)[^"]*"/);
    assert.doesNotMatch(html, /Evidence spine|事实沿线/);
    assert.match(html, /<div class="article-shell"><article class="article-main">/);
    assert.doesNotMatch(html, /<script>alert\("xss"\)<\/script>/);
    assert.match(html, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>alert\("markdown"\)<\/script>/);
    const markdown = await readFile(path.join(outputPath, "article.md"), "utf8");
    assert.doesNotMatch(markdown, /alert\("markdown"\)/);
    assert.match(markdown, /未经信任的正文可能包含/);
    assert.match(markdown, /\[官方演示\]\(https:\/\/example\.com\/demo\.mp4\)/);
    const css = await readFile(path.join(outputPath, "site.css"), "utf8");
    for (const selector of [".comic-editorial-card", ".comic-editorial-row-wide-left", ".comic-editorial-bubble", ".comic-shout", ".comic-editorial-sfx", ".comic-editorial-stat"]) {
      assert.match(css, new RegExp(selector.replace(".", "\\.")));
    }
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("builds pasted text with inert provenance instead of a fabricated source link", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-pasted-text-"));
  const outputPath = path.join(root, "site");
  try {
    const {packagePath, sourceSnapshotPath} = await writePastedTextInput(root);
    await buildSite({inputPath: packagePath, sourceSnapshotPath, approvedOutputRoot: root, outputPath});
    const html = await readFile(path.join(outputPath, "index.html"), "utf8");
    const markdown = await readFile(path.join(outputPath, "article.md"), "utf8");
    assert.match(html, /用户提供原文/);
    assert.doesNotMatch(html, /href="[^"]*fabricated/);
    assert.doesNotMatch(html, />阅读来源<\/a>/);
    assert.match(markdown, /来源：用户提供原文/);
    assert.doesNotMatch(markdown, /来源：\[用户提供原文\]\(/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("backs up an existing output instead of overwriting it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-backup-"));
  const outputPath = path.join(root, "site");
  try {
    await buildSite({inputPath: fixtureUrl, sourceSnapshotPath: snapshotUrl, approvedOutputRoot: root, outputPath, now: () => new Date("2026-08-10T00:00:00.000Z")});
    await writeFile(path.join(outputPath, "user-note.txt"), "keep me", "utf8");
    const second = await buildSite({inputPath: fixtureUrl, sourceSnapshotPath: snapshotUrl, approvedOutputRoot: root, outputPath, now: () => new Date("2026-08-10T01:02:03.000Z")});
    assert.ok(second.backupPath);
    assert.equal(await readFile(path.join(second.backupPath, "user-note.txt"), "utf8"), "keep me");
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("copies approved local images into the generated site", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-assets-"));
  const inputRoot = path.join(root, "input");
  const outputPath = path.join(root, "site");
  try {
    const articlePackage = JSON.parse(await readFile(fixtureUrl, "utf8"));
    articlePackage.article.sections[0].blocks.push({
      type: "image",
      src: "assets/original/evidence.png",
      alt: "验证流程示意图",
      caption: "测试资源",
      factIds: ["fact-1"],
    });
    articlePackage.sourceManifest.assets.push({
      path: "assets/original/evidence.png",
      kind: "original",
      sourceUrl: "https://example.com/evidence.png",
      capturedAt: "2026-08-10T00:00:00.000Z",
      purpose: "测试原始证据图片",
    });
    await mkdir(path.join(inputRoot, "assets", "original"), {recursive: true});
    await mkdir(path.join(inputRoot, "assets", "comic"), {recursive: true});
    const validPng = await readFile(fixtureComicUrl);
    await writeFile(path.join(inputRoot, "assets", "original", "evidence.png"), validPng);
    await writeFile(path.join(inputRoot, "assets", "comic", "test-comic.png"), validPng);
    const packagePath = path.join(inputRoot, "article-package.json");
    await writeFile(packagePath, JSON.stringify(articlePackage), "utf8");

    await buildSite({inputPath: packagePath, sourceSnapshotPath: snapshotUrl, approvedOutputRoot: root, outputPath});
    assert.deepEqual(await readFile(path.join(outputPath, "assets", "original", "evidence.png")), validPng);
    const html = await readFile(path.join(outputPath, "index.html"), "utf8");
    assert.match(html, /src="assets\/original\/evidence\.png"/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("renders escaped comic subtitles below matching panel images", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-subtitles-"));
  const packagePath = path.join(root, "article-package.json");
  const outputPath = path.join(root, "site");
  try {
    const articlePackage = JSON.parse(await readFile(fixtureUrl, "utf8"));
    articlePackage.comic.pages[0].caption = "来源说明";
    articlePackage.comic.pages[0].panelGrid = {columns: 1, rows: 1};
    articlePackage.comic.pages[0].subtitles[0].text = "<script>alert(1)</script>";
    await mkdir(path.join(root, "assets", "comic"), {recursive: true});
    await writeFile(path.join(root, "assets", "comic", "test-comic.png"), await readFile(fixtureComicUrl));
    await writeFile(packagePath, JSON.stringify(articlePackage), "utf8");

    await buildSite({inputPath: packagePath, sourceSnapshotPath: snapshotUrl, approvedOutputRoot: root, outputPath});
    const html = await readFile(path.join(outputPath, "index.html"), "utf8");
    assert.match(html, /class="comic-panel-grid comic-grid-columns-1 comic-grid-rows-1"/);
    assert.match(html, /class="comic-panel-frame comic-panel-col-0 comic-panel-row-0"/);
    assert.match(html, /class="comic-panel-visual"/);
    assert.match(html, /class="comic-panel-sheet"/);
    assert.match(html, /class="comic-subtitle comic-panel-caption" data-kind="narration" data-panel-id="panel-1"/);
    assert.doesNotMatch(html, /comic-panel-overlay/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /<figcaption>来源说明/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("renders escaped Xiaohu-style editorial comics without bitmap dependencies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-editorial-comic-"));
  const packagePath = path.join(root, "article-package.json");
  const outputPath = path.join(root, "site");
  try {
    const articlePackage = JSON.parse(await readFile(fixtureUrl, "utf8"));
    articlePackage.delivery = {comicMode: "editorial"};
    articlePackage.comic.panels[0].display = {
      kind: "thought",
      tone: "speed",
      kicker: "问题出现",
      text: "<script>alert(1)</script>",
      detail: "先把问题变成可追踪任务。",
    };
    articlePackage.comic.pages[0] = {
      id: "comic-page-1",
      format: "editorial",
      number: "01/01",
      caption: "从群聊走向可追踪协作。",
      factIds: ["fact-1"],
      panelIds: ["panel-1"],
      rows: [{layout: "single", panelIds: ["panel-1"]}],
    };
    articlePackage.sourceManifest.assets = [];
    await writeFile(packagePath, JSON.stringify(articlePackage), "utf8");

    await buildSite({inputPath: packagePath, sourceSnapshotPath: snapshotUrl, approvedOutputRoot: root, outputPath});
    const html = await readFile(path.join(outputPath, "index.html"), "utf8");
    assert.match(html, /class="comic-editorial-card"/);
    assert.match(html, /class="comic-editorial-row comic-editorial-row-single"/);
    assert.match(html, /class="comic-editorial-panel comic-thought comic-tone-speed"/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.doesNotMatch(html, /comic-panel-sheet|data-panel-id|fact-1/);
    assert.doesNotMatch(html, /\sstyle=/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("renders media as a safe outbound link without active embeds", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-media-link-"));
  const outputPath = path.join(root, "site");
  try {
    await buildSite({inputPath: fixtureUrl, sourceSnapshotPath: snapshotUrl, approvedOutputRoot: root, outputPath});
    const html = await readFile(path.join(outputPath, "index.html"), "utf8");
    assert.match(html, /class="article-media-link"/);
    assert.match(html, /href="https:\/\/example\.com\/demo\.mp4"/);
    assert.match(html, /rel="noreferrer noopener"/);
    assert.doesNotMatch(html, /<video|<iframe/i);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects incomplete source snapshots before replacing output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-incomplete-"));
  const outputPath = path.join(root, "site");
  const incompleteSnapshotPath = path.join(root, "source-snapshot.json");
  try {
    const snapshot = JSON.parse(await readFile(snapshotUrl, "utf8"));
    snapshot.sections[0].blocks.push({type: "paragraph", text: "这一段正文没有被迁移。"});
    await writeFile(incompleteSnapshotPath, JSON.stringify(snapshot), "utf8");
    await assert.rejects(
      buildSite({inputPath: fixtureUrl, sourceSnapshotPath: incompleteSnapshotPath, approvedOutputRoot: root, outputPath}),
      /content completeness gate failed/i,
    );
    await assert.rejects(access(outputPath));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("copies only referenced manifest assets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-exact-assets-"));
  const inputRoot = path.join(root, "input");
  const outputPath = path.join(root, "site");
  try {
    await mkdir(path.join(inputRoot, "assets", "comic"), {recursive: true});
    await writeFile(path.join(inputRoot, "article-package.json"), await readFile(fixtureUrl));
    await writeFile(path.join(inputRoot, "assets", "comic", "test-comic.png"), await readFile(fixtureComicUrl));
    await writeFile(path.join(inputRoot, "assets", "comic", "unlisted.png"), await readFile(fixtureComicUrl));
    await buildSite({inputPath: path.join(inputRoot, "article-package.json"), sourceSnapshotPath: snapshotUrl, approvedOutputRoot: root, outputPath});
    await assert.rejects(access(path.join(outputPath, "assets", "comic", "unlisted.png")));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects output paths outside the approved root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-approved-root-"));
  try {
    await assert.rejects(buildSite({inputPath: fixtureUrl, sourceSnapshotPath: snapshotUrl, approvedOutputRoot: path.join(root, "approved"), outputPath: path.join(root, "outside")}), /strict descendant|ENOENT/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
