import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const skillUrl = new URL("../../SKILL.md", import.meta.url);
const openAiMetadataUrl = new URL("../../agents/openai.yaml", import.meta.url);
const packageUrl = new URL("../../package.json", import.meta.url);

test("declares 三视图 as an implicit invocation phrase", async () => {
  const skill = await readFile(skillUrl, "utf8");
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const description = frontmatter.match(/^description:\s*"([^"]+)"$/m)?.[1] ?? "";
  const openAiMetadata = await readFile(openAiMetadataUrl, "utf8");
  const packageMetadata = JSON.parse(await readFile(packageUrl, "utf8"));

  assert.ok(description.startsWith("三视图文章网站生成器。"));
  assert.ok(description.indexOf("三视图") <= 20);
  assert.ok(description.length <= 500);
  for (const phrase of ["三视图", "生成三视图", "制作三视图", "做成三视图"]) {
    assert.ok(description.includes(phrase), `missing implicit trigger phrase: ${phrase}`);
  }
  assert.match(openAiMetadata, /allow_implicit_invocation:\s*true/);
  assert.match(openAiMetadata, /用户说“三视图”时自动调用/);
  assert.equal(packageMetadata.version, "2.2.0");
});
