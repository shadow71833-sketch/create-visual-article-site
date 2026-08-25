# Create Visual Article Site v2.2.0 Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing, well-tested skill repository into a credible v2.2.0 open-source release with clear licensing, read-only CI, a reproducible verified demo, public screenshots, and reviewer-friendly documentation.

**Architecture:** Preserve the current content model, builders, security helpers, and 66-test baseline. Add a repository-proof layer around them: governance files, a deterministic repository validator, a checked-in synthetic showcase package, a verified offline demo, CI with read-only permissions, and documentation derived from those artifacts. Image generation happens once through native image generation; CI consumes only checked-in local assets and never needs secrets or network generation.

**Tech Stack:** Node.js 22+ ESM, built-in `node:test`, GitHub Actions (`actions/checkout@v7`, `actions/setup-node@v7`), HTML/CSS/JavaScript static output, native image generation for checked-in PNG comic art.

## Global Constraints

- Work only on branch `codex/release-readiness-v2.2.0` in `/Users/shadow/Documents/New project/create-visual-article-site`.
- Keep the existing core build, security, completeness, rendering, migration, and verification behavior unchanged unless a new failing test proves a release-blocking defect.
- Use MIT License with `Copyright (c) 2026 shadow71833-sketch`.
- Set the release version to `2.2.0` everywhere it is asserted or displayed.
- Keep `create-visual-article-site-v2.0.0.zip`; do not delete or rewrite it in this work.
- Do not add runtime or development dependencies.
- CI must use `permissions: contents: read`, must not use `pull_request_target`, and must not consume secrets.
- The showcase source must be original, non-confidential Chinese content created for this repository.
- AI-generated showcase assets must use native image generation and record file metadata and `generationMethod: "native-imagegen"` in the article package.
- Do not push, publish a GitHub Release, create a remote tag, enable Pages, or change repository settings.

---

### Task 1: Establish release metadata and open-source governance

**Files:**
- Create: `LICENSE`
- Create: `SECURITY.md`
- Create: `CONTRIBUTING.md`
- Create: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `scripts/tests/skill-metadata.test.mjs`

**Interfaces:**
- Consumes: existing package metadata and test runner.
- Produces: version `2.2.0`, MIT licensing, contributor/security expectations, and release history used by repository validation and README links.

- [ ] **Step 1: Update the metadata test to require the release version**

Change the final assertion in `scripts/tests/skill-metadata.test.mjs` to:

```js
assert.equal(packageMetadata.version, "2.2.0");
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test scripts/tests/skill-metadata.test.mjs
```

Expected: FAIL because `package.json` still reports `2.1.2`.

- [ ] **Step 3: Add the exact MIT license**

Create `LICENSE` with:

```text
MIT License

Copyright (c) 2026 shadow71833-sketch

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Add governance documents with concrete repository policies**

Create `SECURITY.md` with these required sections and statements:

```markdown
# Security Policy

## Supported version

Security fixes target the latest release on `main`.

## Reporting a vulnerability

Do not open a public issue for an unpatched vulnerability. Use GitHub's private vulnerability reporting for this repository. Include the affected file or workflow, reproduction conditions, impact, and a minimal proof of concept that does not target systems you do not own.

## Scope

Reports about path traversal, unsafe URL handling, credential exposure, active HTML, untrusted media, output integrity, and verification bypasses are in scope. Never include API keys, cookies, passwords, private documents, or other credentials in a report.
```

Create `CONTRIBUTING.md` with exact local requirements:

```markdown
# Contributing

## Development requirements

- Node.js 22 or newer
- No API key is required for the deterministic test suite
- Do not add source articles, images, or fixtures that contain private or copyrighted material without permission

## Validation

Run `npm test` for code changes and `npm run validate` before opening a pull request. New behavior requires a focused `node:test` regression. Security controls may only be relaxed with a documented threat-model change and a failing test that demonstrates the need.

## Pull requests

Keep changes focused, explain the user-visible effect, list validation commands, and attach desktop/mobile evidence for layout changes. Do not commit secrets, generated backups, or unrelated output directories.
```

Create `CHANGELOG.md` with `2.2.0` and the existing `2.1.2` baseline:

```markdown
# Changelog

All notable changes to this project are documented here.

## [2.2.0] - 2026-08-25

### Added

- MIT licensing and contributor/security policies.
- Read-only GitHub Actions validation.
- A reproducible, verified three-view showcase with desktop and mobile evidence.
- Repository-level release consistency checks and reviewer-oriented documentation.

### Changed

- Expanded the README into a bilingual release and evaluation guide.
- Aligned public comic wording with automatic visual-profile selection.

## [2.1.2] - 2026-08-24

### Added

- Automatic implicit invocation metadata for 三视图 requests.
- Illustrated comic delivery requirements and regression coverage.
```

- [ ] **Step 5: Update `package.json` metadata without adding dependencies**

Set `version` to `2.2.0` and preserve the existing `private`, `type`, and `engines` fields. Scripts added by later tasks must end with this shape:

```json
{
  "test": "node --test scripts/tests/*.test.mjs",
  "demo:build": "node scripts/build-demo.mjs --approved-root . --output docs/demo",
  "demo:verify": "node scripts/verify-output.mjs --approved-root . --output docs/demo",
  "repository:validate": "node scripts/validate-repository.mjs",
  "validate": "npm test && npm run repository:validate && npm run demo:verify"
}
```

- [ ] **Step 6: Run the focused metadata test and verify it passes**

Run:

```bash
node --test scripts/tests/skill-metadata.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Create a local checkpoint commit**

```bash
git add LICENSE SECURITY.md CONTRIBUTING.md CHANGELOG.md package.json scripts/tests/skill-metadata.test.mjs
git commit -m "chore: prepare v2.2.0 open-source release"
```

---

### Task 2: Add deterministic repository validation and read-only CI

**Files:**
- Create: `scripts/validate-repository.mjs`
- Create: `scripts/tests/repository-validation.test.mjs`
- Create: `.github/workflows/ci.yml`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/pull_request_template.md`

**Interfaces:**
- Consumes: repository root, `package.json`, `SKILL.md`, governance files, README, checked-in demo reports.
- Produces: `validateRepository(root): Promise<{ok: boolean, errors: string[]}>` and a CLI that exits nonzero when release evidence is inconsistent.

- [ ] **Step 1: Write failing validator tests**

Create `scripts/tests/repository-validation.test.mjs` with tests that import `validateRepository` and exercise a copied minimal repository tree:

```js
import assert from "node:assert/strict";
import {mkdtemp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
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
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({name: "create-visual-article-site", version})}\n`, "utf8");
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
```

- [ ] **Step 2: Run the focused test and verify it fails**

```bash
node --test scripts/tests/repository-validation.test.mjs
```

Expected: FAIL because `scripts/validate-repository.mjs` does not exist.

- [ ] **Step 3: Implement the repository validator**

Create `scripts/validate-repository.mjs` using only Node built-ins. It must export `validateRepository`, reject a non-directory or symlink root, require the six release files plus both demo reports, parse JSON with caught errors, require package name/version `create-visual-article-site`/`2.2.0`, require the MIT copyright line, require README and changelog to mention `2.2.0`, and require both reports to contain `ok: true`. The CLI must print JSON and set `process.exitCode = 1` when invalid:

```js
import {lstat, readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const REQUIRED_FILES = ["LICENSE", "SECURITY.md", "CONTRIBUTING.md", "CHANGELOG.md", "README.md", "SKILL.md", "docs/demo/verification-report.json", "docs/demo/completeness-report.json"];

async function readRequired(root, relative, errors) {
  const filePath = path.join(root, relative);
  try {
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new TypeError("must be a regular non-symlink file");
    return await readFile(filePath, "utf8");
  } catch (error) {
    errors.push(`${relative}: ${error.message}`);
    return null;
  }
}

export async function validateRepository(rootPath) {
  const root = path.resolve(rootPath);
  const errors = [];
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) throw new TypeError("repository root must be a regular directory");
  const texts = new Map();
  for (const relative of REQUIRED_FILES) texts.set(relative, await readRequired(root, relative, errors));
  const packageText = await readRequired(root, "package.json", errors);
  let packageMetadata;
  try { packageMetadata = JSON.parse(packageText); } catch (error) { errors.push(`package.json: ${error.message}`); }
  if (packageMetadata?.name !== "create-visual-article-site") errors.push("package.json: unexpected package name");
  if (packageMetadata?.version !== "2.2.0") errors.push("package.json: expected version 2.2.0");
  if (!texts.get("LICENSE")?.includes("Copyright (c) 2026 shadow71833-sketch")) errors.push("LICENSE: expected MIT copyright holder");
  for (const relative of ["README.md", "CHANGELOG.md"]) if (!texts.get(relative)?.includes("2.2.0")) errors.push(`${relative}: expected version 2.2.0`);
  for (const relative of ["docs/demo/verification-report.json", "docs/demo/completeness-report.json"]) {
    try {
      const report = JSON.parse(texts.get(relative));
      if (report.ok !== true) errors.push(`${relative}: expected ok true`);
    } catch (error) {
      errors.push(`${relative}: ${error.message}`);
    }
  }
  return {ok: errors.length === 0, errors};
}

async function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const result = await validateRepository(root);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Run the validator tests**

```bash
node --test scripts/tests/repository-validation.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Add a read-only GitHub Actions workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  validate:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Check out repository
        uses: actions/checkout@v7
        with:
          persist-credentials: false
      - name: Set up Node.js
        uses: actions/setup-node@v7
        with:
          node-version: "22"
          package-manager-cache: false
      - name: Validate release
        run: npm run validate
```

- [ ] **Step 6: Add structured contribution templates**

Create a bug form requiring version, input route, expected behavior, sanitized reproduction, validation output without secrets, and operating system. Create a feature form requiring problem, user outcome, supported input route, security impact, and acceptance evidence. Create a pull request template with summary, risk, validation commands, screenshots for visual changes, and a checkbox confirming no secrets or unauthorized source material.

- [ ] **Step 7: Run tests and checkpoint**

```bash
npm test
git diff --check
git add .github scripts/validate-repository.mjs scripts/tests/repository-validation.test.mjs
git commit -m "ci: validate release evidence on pushes and pull requests"
```

Expected: all tests pass and the commit remains local.

---

### Task 3: Build an original, complete, reproducible showcase

**Files:**
- Create: `examples/showcase/source-snapshot.json`
- Create: `examples/showcase/article-package.json`
- Create: `examples/showcase/assets/comic/character-reference.png`
- Create: `examples/showcase/assets/comic/page-01.png`
- Create: `examples/showcase/assets/comic/page-02.png`
- Create: `scripts/build-demo.mjs`
- Create: `scripts/tests/demo.test.mjs`
- Create: `docs/demo/**` through the existing builder

**Interfaces:**
- Consumes: `buildSite`, `verifyOutput`, the v2 content contract, and local native-imagegen PNG assets.
- Produces: `buildDemo({approvedRoot, outputPath}): Promise<{outputPath: string, verification: object}>`, a checked-in verified site, and metrics used by README.

- [ ] **Step 1: Write a failing demo pipeline test**

Create `scripts/tests/demo.test.mjs`:

```js
import assert from "node:assert/strict";
import {mkdtemp, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {buildDemo} from "../build-demo.mjs";

test("builds and verifies the complete showcase", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-demo-"));
  try {
    const outputPath = path.join(root, "site");
    const result = await buildDemo({approvedRoot: root, outputPath});
    assert.equal(result.outputPath, outputPath);
    assert.equal(result.verification.ok, true);
    assert.equal(result.verification.metrics.views, 3);
    assert.equal(result.verification.metrics.textCoverage, 1);
    assert.equal(result.verification.metrics.sectionCoverage, 1);
    assert.equal(result.verification.metrics.onePageFactCoverage, 1);
    assert.equal(result.verification.metrics.comicFactCoverage, 1);
    assert.equal(result.verification.metrics.comicPages, 2);
    assert.equal(result.verification.metrics.comicPanels, 8);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

```bash
node --test scripts/tests/demo.test.mjs
```

Expected: FAIL because the demo builder and showcase package do not exist.

- [ ] **Step 3: Author the exact original showcase source**

Use the title `从长文章到可验证三视图：一条可追踪的内容生产线` and source label `项目原创演示文章`. The source snapshot must be `sourceType: "pasted-text"`, must omit `canonicalUrl`, and must contain these ordered sections:

1. `为什么摘要不能冒充原文` — explain that reading, summary, and comic have different jobs.
2. `同一份事实如何流向三个视图` — a four-stage list: capture, normalize, map facts, verify output.
3. `发布前的六项检查` — a six-row table for text, sections, tables, code, media links, and fact coverage.
4. `失败也必须可解释` — explain incomplete extraction, unsafe media, image-generation fallback, and failed verification.

Create exactly eight facts, `fact-1` through `fact-8`, covering the three-view contract, four stages, six checks, no remote HTML, local assets, complete-mode 100% fact coverage, explicit editorial fallback, and refusal to deliver failed output. Mark source-only claims as `source-claimed`, use `sourceRef: "source-snapshot"`, and omit every `sourceUrl`.

- [ ] **Step 4: Author complete one-page and comic mappings**

Use `delivery.expansionMode: "complete"` and `delivery.comicMode: "illustrated"`. Create one-page modules `overview`, `process`, `coverage`, `failure-modes`, and `sources`, with visible copy that genuinely expresses all eight facts. Create eight storyboard panels with a recurring editor character and a small verification robot. Deliver two image pages, four panels per page, and exactly one escaped HTML subtitle for each panel. Map every fact to visible content in both the one-page and comic views.

- [ ] **Step 5: Generate the three native-imagegen comic assets**

Generate `character-reference.png` first with this prompt:

```text
Create a clean character reference sheet for an editorial comic about trustworthy content transformation. Recurring characters: a Chinese editor in a cobalt-blue jacket carrying a field notebook, and a small warm-orange verification robot with a square display face. Show front, three-quarter, side, and four expressions for the editor; show the robot idle, scanning, warning, and approving. Contemporary editorial illustration, ink outlines, restrained cobalt/orange/cream palette, plain light background, no logos, no long text, no factual claims, no UI dashboard.
```

Generate `page-01.png` using the reference image and this prompt:

```text
Create one coherent four-panel editorial comic page, landscape 3:2, using the provided editor and verification robot reference exactly. Panel 1: the editor receives a long article made of visible paragraphs, a table, and a code block. Panel 2: the editor places the intact article into a transparent capture tray while navigation clutter falls away outside the tray. Panel 3: the robot arranges paragraphs, lists, a table, code, and a media-link symbol into an ordered source ledger without changing them. Panel 4: the editor connects eight glowing fact tokens from the ledger to three doors representing reading, one-page summary, and comic. Varied camera shots, clear environments and actions, expressive characters, continuous visual storytelling. Cobalt/orange/cream editorial illustration, minimal decorative labels, no long text, no fake metrics, no brand logos, no dashboard layout.
```

Generate `page-02.png` using the same reference image and this prompt:

```text
Create the second coherent four-panel editorial comic page, landscape 3:2, continuing the exact editor and verification robot characters. Panel 5: the three doors open onto a calm reading page, a compact process map, and a scene-based comic, all connected to the same ledger. Panel 6: the robot checks six physical gauges symbolizing text, sections, tables, code, media links, and fact coverage; every gauge reaches complete. Panel 7: an unsafe remote image is stopped at a shield while a safe local image passes, and a failed image generator points to an explicit editorial fallback route. Panel 8: the editor and robot stamp a verified local website package only after every check is green; a rejected incomplete package remains outside the gate. Varied shots, expressive actions, visual continuity, cobalt/orange/cream editorial illustration, little or no bitmap text, no invented numbers, no logos, no report-card or dashboard composition.
```

Record native-imagegen provenance plus exact SHA-256, dimensions, MIME type, and byte count in `article-package.json` after inspecting the generated files.

- [ ] **Step 6: Implement the demo builder**

Create `scripts/build-demo.mjs` with an exported function and guarded CLI:

```js
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

import {buildSite} from "./build-site.mjs";
import {verifyOutput} from "./verify-output.mjs";
import {assertApprovedDescendant, atomicWriteFile} from "./lib/security.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const showcaseRoot = path.join(repositoryRoot, "examples", "showcase");

export async function buildDemo({approvedRoot, outputPath} = {}) {
  const resolvedApproved = path.resolve(approvedRoot);
  const resolvedOutput = assertApprovedDescendant(resolvedApproved, path.resolve(outputPath));
  const result = await buildSite({
    inputPath: path.join(showcaseRoot, "article-package.json"),
    sourceSnapshotPath: path.join(showcaseRoot, "source-snapshot.json"),
    approvedOutputRoot: resolvedApproved,
    outputPath: resolvedOutput,
  });
  const verification = await verifyOutput(resolvedOutput);
  await atomicWriteFile(path.join(resolvedOutput, "verification-report.json"), `${JSON.stringify(verification, null, 2)}\n`, {mode: 0o644});
  if (!verification.ok) throw new Error(`showcase verification failed: ${verification.errors.map(({message}) => message).join("; ")}`);
  return {...result, verification};
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new TypeError("Usage: node build-demo.mjs --approved-root <directory> --output <directory>");
    result[flag.slice(2)] = value;
  }
  return result;
}

async function main(argv) {
  const args = parseArgs(argv);
  const result = await buildDemo({approvedRoot: args["approved-root"], outputPath: args.output});
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 7: Build and verify the checked-in demo**

Run:

```bash
node --test scripts/tests/demo.test.mjs
npm run demo:build
npm run demo:verify
```

Expected: the focused test passes; `docs/demo/completeness-report.json` and `docs/demo/verification-report.json` both contain `"ok": true`; the verification metrics report three views, two comic pages, eight comic panels, and 100% reading/one-page/comic coverage.

- [ ] **Step 8: Checkpoint the showcase**

```bash
git add examples/showcase docs/demo scripts/build-demo.mjs scripts/tests/demo.test.mjs package.json
git commit -m "feat: add verified three-view showcase"
```

---

### Task 4: Capture visual evidence and publish reviewer-oriented documentation

**Files:**
- Create: `docs/assets/demo-reading-desktop.png`
- Create: `docs/assets/demo-one-page-desktop.png`
- Create: `docs/assets/demo-comic-desktop.png`
- Create: `docs/assets/demo-mobile.png`
- Modify: `README.md`
- Modify: `SKILL.md`

**Interfaces:**
- Consumes: verified `docs/demo/index.html`, release metadata, test commands, governance files.
- Produces: public proof that a reviewer can understand without reading implementation internals.

- [ ] **Step 1: Open the local demo and capture exact evidence**

Open `docs/demo/index.html` in an available browser. At approximately 1440px width, capture one screenshot for each of the reading, one-page, and comic tabs. At approximately 375px width, capture one screenshot showing mobile navigation and a readable content section. Save only PNG files under `docs/assets/` with the names listed above. Confirm no overflow, clipped titles, internal fact IDs, broken images, or subtitles detached from matching comic art.

- [ ] **Step 2: Rewrite README as a bilingual release page**

Use this section order and keep every claim tied to repository evidence:

```markdown
# Create Visual Article Site / 三视图文章网站生成器

[CI badge] [MIT badge] [Node 22+ badge] [release v2.2.0 badge]

One-sentence English value proposition followed by one-sentence Chinese value proposition.

## See the three views / 查看三视图

Three screenshots with concise captions and a link to `docs/demo/index.html` for offline viewing.

## Why this exists / 为什么需要它

Explain that summaries do not replace source-faithful reading, and that all views share one fact ledger.

## What it guarantees / 核心保证

- 100% measured reading coverage with zero missing blocks
- source-grounded one-page and comic facts
- safe local assets and escaped untrusted content
- deterministic build and verification reports
- responsive, offline, and print-ready delivery

## Install / 安装

Use the existing `npx skills add shadow71833-sketch/create-visual-article-site --skill create-visual-article-site --agent codex -g -y` command.

## Use / 使用

Keep the existing standard and 完整展开 prompts, and add public URL, PDF, Markdown, and pasted-text examples.

## Verified showcase / 可验证演示

List `npm run demo:build`, `npm run demo:verify`, and the measured metrics read from the committed reports.

## Security model / 安全模型

Summarize untrusted-source handling, no cookie export, no remote HTML rendering, safe downloads, secret-shaped value detection, and explicit image-generation fallback. Link `SECURITY.md`.

## Development / 开发

List Node 22+, `npm test`, and `npm run validate`. Link `CONTRIBUTING.md` and `CHANGELOG.md`.

## Project structure / 项目结构

Show only the major skill, scripts, references, assets, examples, and docs directories.

## License

MIT © 2026 shadow71833-sketch.
```

Use repository-relative image URLs. Do not claim download counts, external adoption, Lighthouse scores, or security certification.

- [ ] **Step 3: Align public comic wording**

Replace README wording that says the comic always uses `小互风格` with wording that the automatically selected editorial style is source-grounded. In `SKILL.md`, change only release-facing wording that is inconsistent with v2.2.0 or the README; preserve all safety and completeness requirements.

- [ ] **Step 4: Validate links, metadata, and screenshots**

```bash
npm run repository:validate
npm test
git diff --check
```

Expected: repository validation and all tests pass; every README-relative path exists; no screenshot exceeds 5 MB; no generated backup directory is staged.

- [ ] **Step 5: Checkpoint the documentation**

```bash
git add README.md SKILL.md docs/assets
git commit -m "docs: present verified v2.2.0 release evidence"
```

---

### Task 5: Run final gates and prepare—not publish—the release

**Files:**
- Modify only when a gate reports a concrete defect.
- Produce local review output through Git commands; do not add secrets, logs, or temporary directories.

**Interfaces:**
- Consumes: all v2.2.0 files and tests.
- Produces: a clean local branch ready for user review and an exact release-note draft.

- [ ] **Step 1: Run the full deterministic suite**

```bash
npm run validate
```

Expected: all Node tests pass; repository validation returns `ok: true`; demo verification returns `ok: true`.

- [ ] **Step 2: Run the skill metadata validator**

```bash
python3 /Users/shadow/.codex/skills/.system/skill-creator/scripts/quick_validate.py .
```

Expected: validation succeeds with no unfinished scaffold markers or frontmatter errors.

- [ ] **Step 3: Inspect the final diff and repository hygiene**

```bash
git diff --check main...HEAD
git status --short --branch
git log --oneline --decorate main..HEAD
```

Expected: no whitespace errors; only approved files are changed; local commits are on `codex/release-readiness-v2.2.0`; no push has occurred.

- [ ] **Step 4: Verify public artifact metrics**

Read `docs/demo/verification-report.json` and `docs/demo/completeness-report.json`. Record the exact section, fact, comic-page, comic-panel, and coverage metrics in the handoff. Do not state a Lighthouse score.

- [ ] **Step 5: Prepare exact release notes without publishing**

Use this release title and body in the handoff:

```text
Title: v2.2.0 — Verified showcase and release readiness

This release makes Create Visual Article Site easier to evaluate, install, and contribute to. It adds MIT licensing, read-only CI, repository validation, a complete source-grounded showcase, desktop/mobile visual evidence, and bilingual release documentation while preserving the existing secure build and verification model.

Highlights:
- Verified three-view demo with 100% measured coverage
- Read-only Node.js 22 CI with no secrets
- MIT license, security policy, contribution guide, and changelog
- Reproducible demo build and repository consistency checks
- Bilingual README with real desktop and mobile evidence

Validation:
- npm run validate
- quick_validate.py .
- verification-report.json: ok true
- completeness-report.json: ok true
```

- [ ] **Step 6: Stop before external mutations**

Report the local branch, commits, files, tests, metrics, and release-note draft. Ask for separate action-time approval before pushing the branch, opening a pull request, creating tag `v2.2.0`, or publishing a GitHub Release.

---

## Self-Review

- Spec coverage: licensing, versioning, CI, repository validation, governance, original demo, AI provenance, screenshots, bilingual README, testing, and release preparation each map to a task.
- Placeholder scan: the plan contains no deferred implementation markers; all user choices are fixed in Global Constraints.
- Type consistency: `validateRepository(root)` and `buildDemo({approvedRoot, outputPath})` names are identical in tests and implementations; package scripts invoke the same CLI flags used by their parsers.
