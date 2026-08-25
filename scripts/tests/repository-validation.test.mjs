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
  [
    "README.md",
    "create-visual-article-site\n2.2.0\nhttps://shadow71833-sketch.github.io/create-visual-article-site/\n",
  ],
  ["SKILL.md", "---\nname: create-visual-article-site\n---\n"],
  [
    ".github/workflows/ci.yml",
    "steps:\n  - uses: actions/checkout@a5ac7e51b41094c92402da3b24376905380afc29 # v4.1.7\n",
  ],
  [
    ".github/workflows/pages.yml",
    "steps:\n  - uses: actions/upload-pages-artifact@56afc609e74202658d3ffba0e8f6dda462b719fa # v3.0.1\n",
  ],
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

test("rejects mutable action refs and a missing live demo URL", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-"));
  try {
    await writeRepository(root);
    await writeFile(path.join(root, ".github/workflows/ci.yml"), "steps:\n  - uses: actions/checkout@v7\n", "utf8");
    await writeFile(path.join(root, "README.md"), "create-visual-article-site\n2.2.0\n", "utf8");

    const result = await validateRepository(root);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("full 40-character commit SHA")));
    assert.ok(result.errors.some((error) => error.includes("public Pages URL")));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects mutable action refs in a third workflow", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-"));
  try {
    await writeRepository(root);
    await writeFile(
      path.join(root, ".github/workflows/audit.yml"),
      "steps:\n  - uses: actions/setup-node@v7\n",
      "utf8",
    );

    const result = await validateRepository(root);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes(".github/workflows/audit.yml")));
    assert.ok(result.errors.some((error) => error.includes("actions/setup-node@v7")));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects mutable action refs in yaml-extension workflows", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-"));
  try {
    await writeRepository(root);
    await writeFile(
      path.join(root, ".github/workflows/audit.yaml"),
      "steps:\n  - uses: actions/setup-node@v7\n",
      "utf8",
    );

    const result = await validateRepository(root);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes(".github/workflows/audit.yaml")));
    assert.ok(result.errors.some((error) => error.includes("actions/setup-node@v7")));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects mutable action refs in flow-style mappings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-"));
  try {
    await writeRepository(root);
    await writeFile(
      path.join(root, ".github/workflows/flow.yml"),
      "jobs: {build: {steps: [{uses: actions/checkout@v7}]}}\n",
      "utf8",
    );

    const result = await validateRepository(root);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("actions/checkout@v7")));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("accepts quoted action refs pinned to full commit SHAs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-"));
  try {
    await writeRepository(root);
    await writeFile(
      path.join(root, ".github/workflows/quoted.yaml"),
      [
        "steps:",
        '  - uses: "actions/checkout@a5ac7e51b41094c92402da3b24376905380afc29"',
        "  - uses: 'actions/setup-node@1e60f620b9541d2a7b806cabc06dfae6650ea1b0'",
        "",
      ].join("\n"),
      "utf8",
    );

    assert.deepEqual(await validateRepository(root), {ok: true, errors: []});
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects mutable action refs behind quoted mapping keys", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-"));
  try {
    await writeRepository(root);
    await writeFile(
      path.join(root, ".github/workflows/quoted-keys.yml"),
      [
        "steps:",
        '  - "uses": actions/checkout@v7',
        "  - {'uses': actions/setup-node@v7}",
        '  - {"u\\u0073es": "actions/upload-pages-artifact@v4"}',
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await validateRepository(root);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("actions/checkout@v7")));
    assert.ok(result.errors.some((error) => error.includes("actions/setup-node@v7")));
    assert.ok(result.errors.some((error) => error.includes("actions/upload-pages-artifact@v4")));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("accepts quoted and escaped uses keys with pinned action refs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-"));
  try {
    await writeRepository(root);
    await writeFile(
      path.join(root, ".github/workflows/pinned-quoted-keys.yaml"),
      [
        "steps:",
        '  - "uses": "actions/checkout@a5ac7e51b41094c92402da3b24376905380afc29"',
        "  - {'uses': 'actions/setup-node@1e60f620b9541d2a7b806cabc06dfae6650ea1b0'}",
        '  - {"u\\u0073es": "actions/upload-pages-artifact@56afc609e74202658d3ffba0e8f6dda462b719fa"}',
        "",
      ].join("\n"),
      "utf8",
    );

    assert.deepEqual(await validateRepository(root), {ok: true, errors: []});
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects YAML explicit mapping keys that could bypass action pin validation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-"));
  try {
    await writeRepository(root);
    await writeFile(
      path.join(root, ".github/workflows/explicit-key.yml"),
      [
        "steps:",
        '  - ? "u\\u0073es"',
        "    : actions/checkout@v7",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await validateRepository(root);

    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some(
        (error) =>
          error.includes("explicit-key.yml") &&
          error.includes("explicit mapping keys are not supported"),
      ),
    );
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects mutable action refs behind YAML tag and alias mapping keys", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-"));
  try {
    await writeRepository(root);
    await writeFile(
      path.join(root, ".github/workflows/tagged-key.yml"),
      [
        "steps:",
        "  - !!str uses: actions/checkout@v7",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(root, ".github/workflows/alias-key.yml"),
      [
        "name: &uses-key uses",
        "steps:",
        "  - *uses-key: actions/setup-node@v7",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await validateRepository(root);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("actions/checkout@v7")));
    assert.ok(result.errors.some((error) => error.includes("actions/setup-node@v7")));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("accepts question marks outside YAML explicit mapping-key syntax", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-"));
  try {
    await writeRepository(root);
    await writeFile(
      path.join(root, ".github/workflows/question-marks.yml"),
      [
        "steps:",
        "  - name: Quoted ? text",
        "    if: ${{ contains('release?', '?') }}",
        "    env:",
        '      PUBLIC_URL: "https://example.invalid/path?view=reading"',
        "    run: |",
        "      echo '? block scalar'",
        "  # ? comment",
        "",
      ].join("\n"),
      "utf8",
    );

    assert.deepEqual(await validateRepository(root), {ok: true, errors: []});
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("fails closed on malformed workflows and unsupported YAML tags", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-"));
  try {
    await writeRepository(root);
    await writeFile(
      path.join(root, ".github/workflows/malformed.yml"),
      'steps:\n  - uses: "actions/checkout@unterminated\n',
      "utf8",
    );
    await writeFile(
      path.join(root, ".github/workflows/unsupported-tag.yml"),
      "name: !unsupported tagged\nsteps: []\n",
      "utf8",
    );

    const result = await validateRepository(root);

    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some(
        (error) => error.includes("malformed.yml") && error.includes("YAML validation failed"),
      ),
    );
    assert.ok(
      result.errors.some(
        (error) =>
          error.includes("unsupported-tag.yml") && error.includes("YAML validation failed"),
      ),
    );
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects symlinked workflow files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-"));
  try {
    await writeRepository(root);
    await symlink(path.join(root, "README.md"), path.join(root, ".github/workflows/linked.yml"));

    const result = await validateRepository(root);

    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some(
        (error) =>
          error.includes(".github/workflows/linked.yml") &&
          error.includes("must be a regular non-symlink file"),
      ),
    );
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects a bare uses field instead of silently skipping it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-"));
  try {
    await writeRepository(root);
    await writeFile(path.join(root, ".github/workflows/bare.yml"), "steps:\n  - uses:\n", "utf8");

    const result = await validateRepository(root);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("bare.yml") && error.includes("uses field")));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("rejects the obsolete root release archive", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-"));
  try {
    await writeRepository(root);
    await writeFile(path.join(root, "create-visual-article-site-v2.0.0.zip"), "stale", "utf8");

    const result = await validateRepository(root);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("obsolete root release archive")));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("treats a directory or symlink at the obsolete archive path as a violation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-"));
  try {
    await writeRepository(root);
    const obsoleteArchive = path.join(root, "create-visual-article-site-v2.0.0.zip");
    await mkdir(obsoleteArchive);

    let result = await validateRepository(root);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("obsolete root release archive")));

    await rm(obsoleteArchive, {recursive: true});
    await symlink(path.join(root, "README.md"), obsoleteArchive);

    result = await validateRepository(root);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("obsolete root release archive")));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("checks only the exact obsolete archive path at the repository root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-repo-"));
  try {
    await writeRepository(root);
    await writeFile(path.join(root, "create-visual-article-site-v2.0.0.zip.sha256"), "allowed\n", "utf8");
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, "nested", "create-visual-article-site-v2.0.0.zip"), "allowed", "utf8");

    assert.deepEqual(await validateRepository(root), {ok: true, errors: []});
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
