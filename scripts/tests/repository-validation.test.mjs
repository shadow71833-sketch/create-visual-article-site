import assert from "node:assert/strict";
import {mkdtemp, mkdir, rm, symlink, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {validateRepository} from "../validate-repository.mjs";

const requiredText = new Map([
  ["LICENSE", "MIT License\nCopyright (c) 2026 shadow71833-sketch\n"],
  ["SECURITY.md", "# Security Policy\n"],
  ["CONTRIBUTING.md", "# Contributing\n"],
  ["CHANGELOG.md", "## [2.2.0] - 2026-08-25\n"],
  ["README.md", "create-visual-article-site\n2.2.0\n"],
  ["SKILL.md", "---\nname: create-visual-article-site\n---\n"],
]);

async function writeRepository(root, version = "2.2.0") {
  for (const [relative, content] of requiredText) {
    await mkdir(path.dirname(path.join(root, relative)), {recursive: true});
    await writeFile(path.join(root, relative), content, "utf8");
  }
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({name: "create-visual-article-site", version})}\n`,
    "utf8",
  );
  await mkdir(path.join(root, "docs", "demo"), {recursive: true});
  await writeFile(path.join(root, "docs", "demo", "verification-report.json"), '{"ok":true}\n', "utf8");
  await writeFile(path.join(root, "docs", "demo", "completeness-report.json"), '{"ok":true}\n', "utf8");
}

test("accepts coherent v2.2.0 release evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-"));
  try {
    await writeRepository(root);
    assert.deepEqual(await validateRepository(root), {ok: true, errors: []});
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("reports missing governance and stale release evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-"));
  try {
    await writeRepository(root, "2.1.2");
    await rm(path.join(root, "LICENSE"));
    const result = await validateRepository(root);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("LICENSE")));
    assert.ok(result.errors.some((error) => error.includes("2.2.0")));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("reports malformed metadata and rejects symlinked release evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-"));
  try {
    await writeRepository(root);
    await writeFile(path.join(root, "package.json"), "{not-json}\n", "utf8");
    await writeFile(path.join(root, "docs", "demo", "verification-report.json"), "[]\n", "utf8");
    await rm(path.join(root, "SECURITY.md"));
    await symlink(path.join(root, "CONTRIBUTING.md"), path.join(root, "SECURITY.md"));

    const result = await validateRepository(root);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.startsWith("package.json:")));
    assert.ok(result.errors.some((error) => error.includes("verification-report.json: expected ok true")));
    assert.ok(result.errors.some((error) => error.includes("SECURITY.md: must be a regular non-symlink file")));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects file and symlink repository roots", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-root-"));
  try {
    const fileRoot = path.join(parent, "repository.txt");
    const directoryRoot = path.join(parent, "repository");
    const symlinkRoot = path.join(parent, "repository-link");
    await writeFile(fileRoot, "not a repository\n", "utf8");
    await mkdir(directoryRoot);
    await symlink(directoryRoot, symlinkRoot);

    await assert.rejects(validateRepository(fileRoot), /repository root must be a regular directory/);
    await assert.rejects(validateRepository(symlinkRoot), /repository root must be a regular directory/);
  } finally {
    await rm(parent, {recursive: true, force: true});
  }
});
