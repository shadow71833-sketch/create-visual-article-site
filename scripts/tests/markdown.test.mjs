import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderArticleMarkdown } from "../lib/markdown.mjs";

const fixtureUrl = new URL("./fixtures/article-package.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));

function pastedTextPackage() {
  const value = structuredClone(fixture);
  value.article.source = {
    sourceType: "pasted-text",
    name: "用户提供原文",
    verified: false,
  };
  return value;
}

test("serializes every reading block and media link", () => {
  const markdown = renderArticleMarkdown(structuredClone(fixture));
  assert.match(markdown, /^# 长周期智能体如何交付真实工作/m);
  assert.match(markdown, /未经信任的正文可能包含/);
  assert.match(markdown, /\| 阶段 \| 结果 \|/);
  assert.match(markdown, /```text\nconst verified = true;\n```/);
  assert.match(markdown, /\[官方演示\]\(https:\/\/example\.com\/demo\.mp4\)/);
  assert.match(markdown, /查看长周期任务的完整过程。/);
});

test("escapes Markdown table pipes without altering source code", () => {
  const value = structuredClone(fixture);
  value.article.sections[0].blocks[2].rows[0][1] = "可运行 | 已核验";
  value.article.sections[0].blocks[3].text = "const value = `a|b`;";
  const markdown = renderArticleMarkdown(value);
  assert.match(markdown, /可运行 \\| 已核验/);
  assert.match(markdown, /const value = `a\|b`;/);
});

test("neutralizes Markdown links and images supplied as plain article text", () => {
  const value = structuredClone(fixture);
  value.article.sections[0].blocks[0].text = "![remote](https://evil.example/x.png) [danger](javascript:alert(1))";
  const markdown = renderArticleMarkdown(value);
  assert.match(markdown, /\\!\\\[remote\\\]\\\(https:\/\/evil\\\.example\/x\\\.png\\\)/);
  assert.match(markdown, /\\\[danger\\\]\\\(javascript:alert\\\(1\\\)\\\)/);
  assert.doesNotMatch(markdown, /(?<!\\)\]\(javascript:/u);
});

test("renders pasted-text provenance as plain Markdown without a fabricated link", () => {
  const markdown = renderArticleMarkdown(pastedTextPackage());
  assert.match(markdown, /来源：用户提供原文/);
  assert.doesNotMatch(markdown, /来源：\[用户提供原文\]\(/);
});
