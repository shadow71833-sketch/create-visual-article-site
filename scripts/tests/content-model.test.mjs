import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertArticlePackage,
  validateArticlePackage,
  validateSourceSnapshot,
} from "../lib/content-model.mjs";

const fixtureUrl = new URL("./fixtures/article-package.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));

function pastedTextPackage() {
  const value = structuredClone(fixture);
  value.article.source = {
    sourceType: "pasted-text",
    name: "用户提供原文",
    verified: false,
  };
  value.facts = value.facts.map(({sourceUrl, ...fact}) => ({
    ...fact,
    sourceRef: "source-snapshot",
  }));
  value.sourceManifest = {
    sourceType: "pasted-text",
    sourceName: "用户提供原文",
    capturedAt: value.sourceManifest.capturedAt,
    assets: value.sourceManifest.assets,
  };
  return value;
}

function editorialPackage() {
  const value = structuredClone(fixture);
  value.delivery = {comicMode: "editorial"};
  value.comic.panels[0].display = {
    kind: "thought",
    tone: "light",
    text: "又要把问题丢进群里？",
    detail: "先把问题变成可追踪任务。",
  };
  value.comic.pages[0] = {
    id: "comic-page-1",
    format: "editorial",
    number: "01/01",
    caption: "从群聊走向可追踪协作。",
    factIds: ["fact-1"],
    panelIds: ["panel-1"],
    rows: [{layout: "single", panelIds: ["panel-1"]}],
  };
  value.sourceManifest.assets = [];
  return value;
}

test("accepts a complete article package", () => {
  assert.doesNotThrow(() => assertArticlePackage(structuredClone(fixture)));
  assert.deepEqual(validateArticlePackage(structuredClone(fixture)), []);
});

test("defaults to illustrated comics and requires explicit editorial fallback", () => {
  const implicitEditorial = editorialPackage();
  delete implicitEditorial.delivery;
  assert.ok(validateArticlePackage(implicitEditorial).some((error) => error.path === "comic.pages[0].format" && /illustrated/.test(error.message)));

  assert.deepEqual(validateArticlePackage(editorialPackage()), []);

  const editorialWithImage = structuredClone(fixture);
  editorialWithImage.delivery = {comicMode: "editorial"};
  assert.ok(validateArticlePackage(editorialWithImage).some((error) => error.path === "comic.pages[0].format" && /editorial/.test(error.message)));

  const invalidMode = structuredClone(fixture);
  invalidMode.delivery = {comicMode: "text-cards"};
  assert.ok(validateArticlePackage(invalidMode).some((error) => error.path === "delivery.comicMode"));
});

test("requires full one-page and comic fact coverage in complete-expansion mode", () => {
  const complete = structuredClone(fixture);
  complete.delivery = {expansionMode: "complete"};
  assert.deepEqual(validateArticlePackage(complete), []);

  const incomplete = structuredClone(complete);
  incomplete.facts.push({
    id: "fact-2",
    claim: "新增事实必须进入两个摘要视图。",
    sourceUrl: "https://example.com/research/qwen#second-result",
    status: "source-claimed",
  });
  const errors = validateArticlePackage(incomplete);
  assert.ok(errors.some((error) => error.path === "delivery.expansionMode" && /one-page.*fact-2/i.test(error.message)));
  assert.ok(errors.some((error) => error.path === "delivery.expansionMode" && /comic.*fact-2/i.test(error.message)));

  const invalidMode = structuredClone(fixture);
  invalidMode.delivery = {expansionMode: "unbounded"};
  assert.ok(validateArticlePackage(invalidMode).some((error) => error.path === "delivery.expansionMode"));
});

test("accepts pasted text without fabricating public source URLs", () => {
  const value = pastedTextPackage();
  assert.deepEqual(validateArticlePackage(value), []);

  const snapshot = {
    version: 2,
    sourceType: "pasted-text",
    sourceName: "用户提供原文",
    capturedAt: "2026-08-10T00:00:00.000Z",
    preamble: {title: "返程路上的运营复盘"},
    sections: [{id: "notes", title: "记录", blocks: [{type: "paragraph", text: "先有数字化，再有自动化。"}]}],
  };
  assert.deepEqual(validateSourceSnapshot(snapshot), []);
});

test("keeps public URL requirements and rejects ambiguous pasted-text provenance", () => {
  const publicPackage = structuredClone(fixture);
  delete publicPackage.article.source.url;
  assert.ok(validateArticlePackage(publicPackage).some((error) => error.path === "article.source.url"));

  const pastedPackage = pastedTextPackage();
  delete pastedPackage.facts[0].sourceRef;
  pastedPackage.article.source.url = "https://example.com/fabricated";
  pastedPackage.sourceManifest.originalUrl = "https://example.com/fabricated";
  const errors = validateArticlePackage(pastedPackage);
  assert.ok(errors.some((error) => error.path === "facts[0].sourceRef"));
  assert.ok(errors.some((error) => error.path === "article.source.url"));
  assert.ok(errors.some((error) => error.path === "sourceManifest.originalUrl"));
});

test("reports paths for malformed required values", () => {
  const value = structuredClone(fixture);
  value.article.title = "";
  value.facts[0].status = "invented";

  const errors = validateArticlePackage(value);
  assert.ok(errors.some((error) => error.path === "article.title"));
  assert.ok(errors.some((error) => error.path === "facts[0].status"));
});

test("requires unique fact mappings in one-page and comic views", () => {
  const value = structuredClone(fixture);
  value.facts.push({...value.facts[0]});
  value.onePage.metrics[0].factIds = [];
  value.onePage.modules[0].items[0].factIds = ["fact-1", "fact-1"];
  const errors = validateArticlePackage(value);
  assert.ok(errors.some((error) => error.path === "facts[1].id" && error.message === "must be unique"));
  assert.ok(errors.some((error) => error.path === "onePage.metrics[0].factIds" && /non-empty/.test(error.message)));
  assert.ok(errors.some((error) => error.path === "onePage.modules[0].items[0].factIds[1]" && /unique/.test(error.message)));
});

test("rejects unsupported blocks and unsafe asset paths", () => {
  const value = structuredClone(fixture);
  value.article.sections[0].blocks.push({type: "raw-html", html: "<b>bad</b>"});
  value.comic.pages[0] = {
    id: "page-1",
    image: "../private.png",
    alt: "unsafe",
    caption: "unsafe",
    factIds: [],
  };

  const errors = validateArticlePackage(value);
  assert.ok(errors.some((error) => error.path.endsWith("blocks[5].type")));
  assert.ok(errors.some((error) => error.path === "comic.pages[0].image"));
});

test("rejects invalid theme colors and source URLs", () => {
  const value = structuredClone(fixture);
  value.theme.colors.accent = "expression(alert(1))";
  value.article.source.url = "javascript:alert(1)";

  const errors = validateArticlePackage(value);
  assert.ok(errors.some((error) => error.path === "theme.colors.accent"));
  assert.ok(errors.some((error) => error.path === "article.source.url"));
});

test("rejects unsafe source-manifest asset entries", () => {
  const value = structuredClone(fixture);
  value.sourceManifest.assets[0] = {
    path: "../../browser-profile/cookies",
    kind: "downloaded",
    sourceUrl: "http://127.0.0.1/private",
  };

  const errors = validateArticlePackage(value);
  assert.ok(errors.some((error) => error.path === "sourceManifest.assets[0].path"));
  assert.ok(errors.some((error) => error.path === "sourceManifest.assets[0].kind"));
  assert.ok(errors.some((error) => error.path === "sourceManifest.assets[0].sourceUrl"));
});

test("validates comic page subtitles", () => {
  const valid = structuredClone(fixture);
  assert.deepEqual(validateArticlePackage(valid), []);

  const invalid = structuredClone(valid);
  invalid.comic.pages[0].subtitles[0].kind = "headline";
  invalid.comic.pages[0].subtitles[0].text = "";
  invalid.comic.pages[0].subtitles[0].factIds = ["missing-fact"];
  invalid.comic.pages[0].subtitles[0].panelId = "panel-missing";
  const renderedErrors = validateArticlePackage(invalid)
    .map(({path, message}) => `${path}: ${message}`)
    .join("\n");
  assert.match(renderedErrors, /comic\.pages\[0\]\.subtitles/);
  assert.match(renderedErrors, /must be narration or dialogue/);
  assert.match(renderedErrors, /references an unknown fact/);
  assert.match(renderedErrors, /must match the panel ID/);
});

test("validates optional comic panel grids against delivered panel counts", () => {
  const valid = structuredClone(fixture);
  valid.comic.pages[0].panelGrid = {columns: 1, rows: 1};
  assert.deepEqual(validateArticlePackage(valid), []);

  const zeroColumns = structuredClone(valid);
  zeroColumns.comic.pages[0].panelGrid.columns = 0;
  assert.ok(validateArticlePackage(zeroColumns).some((error) => error.path === "comic.pages[0].panelGrid.columns"));

  const tooManyColumns = structuredClone(valid);
  tooManyColumns.comic.pages[0].panelGrid.columns = 6;
  assert.ok(validateArticlePackage(tooManyColumns).some((error) => error.path === "comic.pages[0].panelGrid.columns"));

  const mismatched = structuredClone(valid);
  mismatched.comic.pages[0].panelGrid = {columns: 2, rows: 2};
  assert.ok(validateArticlePackage(mismatched).some((error) => error.path === "comic.pages[0].panelGrid" && /panelIds/.test(error.message)));
});

test("accepts Xiaohu-style editorial comic pages without bitmap assets", () => {
  const value = editorialPackage();
  assert.deepEqual(validateArticlePackage(value), []);
});

test("rejects invalid editorial comic layouts and display content", () => {
  const invalidLayout = editorialPackage();
  invalidLayout.comic.pages[0].rows[0].layout = "arbitrary-css";
  assert.ok(validateArticlePackage(invalidLayout).some((error) => error.path === "comic.pages[0].rows[0].layout"));

  const duplicatePanel = editorialPackage();
  duplicatePanel.comic.pages[0].rows.push({layout: "single", panelIds: ["panel-1"]});
  assert.ok(validateArticlePackage(duplicatePanel).some((error) => error.path === "comic.pages[0].rows" && /exactly once and in order/.test(error.message)));

  const invalidDisplay = editorialPackage();
  invalidDisplay.comic.panels[0].display.kind = "iframe";
  invalidDisplay.comic.panels[0].display.text = "";
  assert.ok(validateArticlePackage(invalidDisplay).some((error) => error.path === "comic.panels[0].display.kind"));
  assert.ok(validateArticlePackage(invalidDisplay).some((error) => error.path === "comic.panels[0].display.text"));

  const missingDisplay = editorialPackage();
  delete missingDisplay.comic.panels[0].display;
  assert.ok(validateArticlePackage(missingDisplay).some((error) => error.path === "comic.panels[0].display"));
});

test("validates safe media-link blocks", () => {
  assert.deepEqual(validateArticlePackage(structuredClone(fixture)), []);

  const invalid = structuredClone(fixture);
  invalid.article.sections[0].blocks[4].url = "javascript:alert(1)";
  const errors = validateArticlePackage(invalid);
  assert.ok(errors.some((error) => error.path === "article.sections[0].blocks[4].url"));
});
