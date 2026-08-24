import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { auditCompleteness } from "../lib/completeness.mjs";
import { auditPresentationCoverage } from "../lib/presentation-coverage.mjs";

const fixtureUrl = new URL("./fixtures/article-package.json", import.meta.url);
const snapshotUrl = new URL("./fixtures/source-snapshot.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
const snapshot = JSON.parse(await readFile(snapshotUrl, "utf8"));

function editorialPackage() {
  const value = structuredClone(fixture);
  value.delivery = {comicMode: "editorial"};
  value.comic.panels[0].display = {
    kind: "takeaway",
    text: "错误必须回到修复循环。",
    detail: "测试与回退构成可验证的交付。",
  };
  value.comic.pages[0] = {
    id: "comic-page-1",
    format: "editorial",
    number: "01/01",
    caption: "编辑漫画也必须覆盖事实。",
    factIds: ["fact-1"],
    panelIds: ["panel-1"],
    rows: [{layout: "single", panelIds: ["panel-1"]}],
  };
  value.sourceManifest.assets = [];
  return value;
}

test("requires source-faithful text and complete structural coverage", () => {
  const report = auditCompleteness(structuredClone(snapshot), structuredClone(fixture));
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.metrics.textCoverage, 1);
  assert.equal(report.metrics.sectionCoverage, 1);
  assert.equal(report.metrics.tableCoverage, 1);
  assert.equal(report.metrics.codeCoverage, 1);
  assert.equal(report.metrics.mediaCoverage, 1);
  assert.deepEqual(report.missing, []);
});

test("measures presentation coverage and gates complete-expansion packages", () => {
  const complete = structuredClone(fixture);
  complete.delivery = {expansionMode: "complete"};
  const cleanCoverage = auditPresentationCoverage(complete);
  assert.equal(cleanCoverage.onePageFactCoverage, 1);
  assert.equal(cleanCoverage.comicFactCoverage, 1);
  assert.deepEqual(cleanCoverage.missingOnePageFactIds, []);
  assert.deepEqual(cleanCoverage.missingComicFactIds, []);

  complete.facts.push({
    id: "fact-2",
    claim: "新增事实必须被完整展开。",
    sourceUrl: "https://example.com/research/qwen#fact-2",
    status: "source-claimed",
  });
  const report = auditCompleteness(structuredClone(snapshot), complete);
  assert.equal(report.ok, false);
  assert.equal(report.metrics.onePageFactCoverage, 0.5);
  assert.equal(report.metrics.comicFactCoverage, 0.5);
  assert.deepEqual(report.presentation.missingOnePageFactIds, ["fact-2"]);
  assert.deepEqual(report.presentation.missingComicFactIds, ["fact-2"]);
  assert.ok(report.errors.some((error) => error.code === "one-page-fact-coverage"));
  assert.ok(report.errors.some((error) => error.code === "comic-fact-coverage"));
});

test("measures editorial comic coverage from visible panel rows", () => {
  const coverage = auditPresentationCoverage(editorialPackage());
  assert.equal(coverage.comicFactCoverage, 1);
  assert.deepEqual(coverage.missingComicFactIds, []);
});

test("reports omitted reading blocks and fails the text threshold", () => {
  const incomplete = structuredClone(fixture);
  incomplete.article.sections[0].blocks.shift();

  const report = auditCompleteness(structuredClone(snapshot), incomplete);
  assert.equal(report.ok, false);
  assert.ok(report.metrics.textCoverage < 0.98);
  assert.ok(report.missing.some((item) => item.path === "sections[0].blocks[0]"));
  assert.ok(report.errors.some((error) => error.code === "text-coverage"));
});

test("requires source sections and structured blocks in source order", () => {
  const reordered = structuredClone(fixture);
  reordered.article.sections[0].blocks.reverse();

  const report = auditCompleteness(structuredClone(snapshot), reordered);
  assert.equal(report.ok, false);
  assert.ok(report.metrics.textCoverage < 1);
  assert.ok(report.missing.length > 0);
});

test("counts the title, deck, summary, and key points as source text", () => {
  const rewritten = structuredClone(fixture);
  rewritten.article.keyPoints[0] = "被改写的速览";
  const report = auditCompleteness(structuredClone(snapshot), rewritten);
  assert.equal(report.ok, false);
  assert.ok(report.missing.some((item) => item.path === "preamble.keyPoints[0]"));
});
