# Repository Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reproducible v2.2.0 release packager, SHA-pinned CI and GitHub Pages deployment, repository-level regression checks, and clear live-demo/release documentation while removing the obsolete v2.0.0 archive.

**Architecture:** Keep release packaging as a focused Node.js maintainer tool that shells out only to `git archive` with an explicit allowlist and writes a SHA-256 sidecar. Keep deployment in a separate least-privilege Pages workflow. Extend the existing repository validator so pull requests fail when required workflows disappear, an action ref is mutable, or the obsolete root ZIP returns.

**Tech Stack:** Node.js 22+, `node:test`, Git, GitHub Actions, GitHub Pages, Markdown.

## Global Constraints

- Do not add third-party runtime or development dependencies.
- Build the v2.2.0 release asset from the immutable annotated tag `v2.2.0`, never from the moving `main` branch.
- The ZIP may contain only `SKILL.md`, `agents/`, `assets/`, `references/`, `scripts/`, `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, `SECURITY.md`, and `CONTRIBUTING.md`, all under the prefix `create-visual-article-site/`.
- Every `uses:` reference in `.github/workflows/*.yml` must be a full 40-character commit SHA with a human-readable version comment.
- The Pages artifact is exactly `docs/demo`; it must be rebuilt and verified before upload.
- Do not change the package version or move the `v2.2.0` tag because the distributed skill behavior is unchanged.
- Delete `create-visual-article-site-v2.0.0.zip`; do not commit generated replacement archives or checksum files.
- Preserve read-only permissions for CI and grant `pages: write` plus `id-token: write` only to the Pages deploy job.

---

## File Map

- `scripts/package-release.mjs`: validate release inputs, invoke `git archive` without a shell, and emit ZIP/checksum metadata.
- `scripts/tests/package-release.test.mjs`: prove repeatability, path allowlisting, checksum correctness, invalid-ref handling, and non-overwrite behavior.
- `scripts/validate-repository.mjs`: enforce required workflows, immutable action refs, the live-demo URL, and absence of the obsolete ZIP.
- `scripts/tests/repository-validation.test.mjs`: regression fixtures for workflow pinning and obsolete-archive detection.
- `.github/workflows/ci.yml`: keep existing validation while pinning official actions.
- `.github/workflows/pages.yml`: rebuild, verify, upload, and deploy `docs/demo`.
- `package.json`: expose `release:package` without adding dependencies.
- `README.md`: add the public Pages URL and immutable v2.2.0 download/checksum links.
- `CHANGELOG.md`: document the unreleased repository and distribution hardening.
- `create-visual-article-site-v2.0.0.zip`: remove the misleading old package.

### Task 1: Deterministic Tag-Based Release Packager

**Files:**
- Create: `scripts/package-release.mjs`
- Create: `scripts/tests/package-release.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: a regular Git repository root, a tag matching `/^v\d+\.\d+\.\d+$/`, and a non-existing output directory beneath an approved root.
- Produces: `packageRelease({repositoryRoot, approvedRoot, ref, outputDirectory})`, returning a promise for an object with string properties `archivePath`, `checksumPath`, `sha256`, and `commit`.
- CLI example: `release_root="$(mktemp -d)"; node scripts/package-release.mjs --repository . --approved-root "$release_root" --ref v2.2.0 --output "$release_root/output"`.

- [ ] **Step 1: Write the failing package tests**

Create a temporary Git repository in `scripts/tests/package-release.test.mjs`, commit the allowed files plus deliberately excluded `.github/workflows/ci.yml`, `docs/demo/index.html`, and `create-visual-article-site-v2.0.0.zip`, and tag it `v2.2.0`. Add these tests:

```js
test("packages an immutable release tag reproducibly", async () => {
  const first = await packageRelease({repositoryRoot, approvedRoot, ref: "v2.2.0", outputDirectory: firstOutput});
  const second = await packageRelease({repositoryRoot, approvedRoot, ref: "v2.2.0", outputDirectory: secondOutput});
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(readCentralDirectoryNames(await readFile(first.archivePath)), [
    "create-visual-article-site/",
    "create-visual-article-site/CHANGELOG.md",
    "create-visual-article-site/CONTRIBUTING.md",
    "create-visual-article-site/LICENSE",
    "create-visual-article-site/README.md",
    "create-visual-article-site/SECURITY.md",
    "create-visual-article-site/SKILL.md",
    "create-visual-article-site/agents/",
    "create-visual-article-site/agents/openai.yaml",
    "create-visual-article-site/assets/",
    "create-visual-article-site/assets/site-template/",
    "create-visual-article-site/assets/site-template/index.html",
    "create-visual-article-site/package.json",
    "create-visual-article-site/references/",
    "create-visual-article-site/references/content-contract.md",
    "create-visual-article-site/scripts/",
    "create-visual-article-site/scripts/build-site.mjs",
  ]);
  assert.equal(
    await readFile(first.checksumPath, "utf8"),
    `${first.sha256}  create-visual-article-site-v2.2.0.zip\n`,
  );
});

test("rejects invalid refs, output escapes, symlink roots, and existing destinations", async () => {
  await assert.rejects(packageRelease({...validOptions, ref: "main"}), /release ref must match/);
  await assert.rejects(packageRelease({...validOptions, outputDirectory: outsideRoot}), /approved root/);
  await assert.rejects(packageRelease({...validOptions, repositoryRoot: symlinkRoot}), /regular directory/);
  await mkdir(validOptions.outputDirectory);
  await assert.rejects(packageRelease(validOptions), /output directory already exists/);
});
```

The test helper `readCentralDirectoryNames(buffer)` must scan ZIP central-directory records beginning with signature `0x02014b50`, read the filename length at offset 28, extra length at offset 30, comment length at offset 32, and return decoded UTF-8 names without extracting the archive.

- [ ] **Step 2: Run the focused tests and verify the missing module failure**

Run: `node --test scripts/tests/package-release.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../package-release.mjs`.

- [ ] **Step 3: Implement the minimal release packager**

Implement these constants and validation boundaries in `scripts/package-release.mjs`:

```js
const RELEASE_REF = /^v\d+\.\d+\.\d+$/;
const RELEASE_PATHS = [
  "SKILL.md", "agents", "assets", "references", "scripts", "package.json",
  "README.md", "LICENSE", "CHANGELOG.md", "SECURITY.md", "CONTRIBUTING.md",
];

function runGit(repositoryRoot, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repositoryRoot, ...args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`git command failed with exit code ${code}: ${stderr.trim()}`));
    });
  });
}
```

`packageRelease` must:

1. Resolve and `lstat` the repository and approved roots; reject non-directories and symlinks.
2. Require `ref` to match `RELEASE_REF`.
3. Resolve the output through `assertApprovedDescendant(approvedRoot, outputDirectory)`.
4. Refuse an existing output directory instead of overwriting it.
5. Resolve the immutable commit by passing `rev-parse`, `--verify`, and `${ref}^{commit}` as separate `git` arguments.
6. Derive `archivePath` as `path.join(outputDirectory, "create-visual-article-site-" + ref + ".zip")` and `checksumPath` as `archivePath + ".sha256"`; for `v2.2.0` these names are exactly `create-visual-article-site-v2.2.0.zip` and `create-visual-article-site-v2.2.0.zip.sha256`.
7. Create the output directory, then run:

```js
await runGit(repositoryRoot, [
  "archive",
  "--format=zip",
  "--prefix=create-visual-article-site/",
  `--output=${archivePath}`,
  ref,
  ...RELEASE_PATHS,
]);
```

8. Hash the archive bytes with `createHash("sha256")` and write `${sha256}  ${path.basename(archivePath)}\n` to `checksumPath` using `atomicWriteFile`.
9. On any failure after directory creation, remove only the newly created output directory and rethrow.
10. Parse CLI flags in pairs, reject missing or unknown flags, print JSON metadata, and set a non-zero exit code without exposing repository credentials.

- [ ] **Step 4: Expose the packaging command**

Add this exact script to `package.json`:

```json
"release:package": "node scripts/package-release.mjs"
```

- [ ] **Step 5: Run focused and full tests**

Run: `node --test scripts/tests/package-release.test.mjs`

Expected: all package-release tests PASS.

Run: `npm test`

Expected: every test PASS with zero failures.

- [ ] **Step 6: Commit the packager**

```bash
git add package.json scripts/package-release.mjs scripts/tests/package-release.test.mjs
git commit -m "feat: add reproducible release packaging"
```

### Task 2: Repository Policy Regression Checks

**Files:**
- Modify: `scripts/validate-repository.mjs`
- Modify: `scripts/tests/repository-validation.test.mjs`

**Interfaces:**
- Consumes: the existing repository root plus required workflow and documentation files.
- Produces: the existing `{ok: boolean, errors: string[]}` result with deterministic workflow, Pages URL, and obsolete-archive errors.

- [ ] **Step 1: Extend the fixture and write failing regressions**

Update `writeRepository` to create `.github/workflows/ci.yml` and `.github/workflows/pages.yml` containing pinned 40-character action refs, and add the public URL `https://shadow71833-sketch.github.io/create-visual-article-site/` to the fixture README.

Add these tests:

```js
test("rejects mutable action refs and a missing live demo URL", async () => {
  await writeRepository(root);
  await writeFile(path.join(root, ".github/workflows/ci.yml"), "steps:\n  - uses: actions/checkout@v7\n", "utf8");
  await writeFile(path.join(root, "README.md"), "create-visual-article-site\n2.2.0\n", "utf8");
  const result = await validateRepository(root);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("full 40-character commit SHA")));
  assert.ok(result.errors.some((error) => error.includes("public Pages URL")));
});

test("rejects the obsolete root release archive", async () => {
  await writeRepository(root);
  await writeFile(path.join(root, "create-visual-article-site-v2.0.0.zip"), "stale", "utf8");
  const result = await validateRepository(root);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("obsolete root release archive")));
});
```

- [ ] **Step 2: Run the focused validator tests and verify failure**

Run: `node --test scripts/tests/repository-validation.test.mjs`

Expected: FAIL because mutable refs, Pages URL, and the obsolete archive are not yet checked.

- [ ] **Step 3: Implement workflow and archive checks**

Add both workflows to `REQUIRED_FILES`, add `const PAGES_URL = "https://shadow71833-sketch.github.io/create-visual-article-site/"`, and implement:

```js
function validateActionPins(relative, text, errors) {
  if (text === null) return;
  for (const match of text.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
    const action = match[1];
    const separator = action.lastIndexOf("@");
    const ref = separator === -1 ? "" : action.slice(separator + 1);
    if (!/^[a-f0-9]{40}$/i.test(ref)) {
      errors.push(`${relative}: action ${action} must use a full 40-character commit SHA`);
    }
  }
}
```

Call it for both workflow texts. Require the README to include `PAGES_URL`. Use `lstat` only on the exact obsolete ZIP path: treat `ENOENT` as success, and report `create-visual-article-site-v2.0.0.zip: obsolete root release archive must be removed` for a file, directory, or symlink.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test scripts/tests/repository-validation.test.mjs`

Expected: all repository-validation tests PASS.

Run: `npm test`

Expected: every test PASS with zero failures.

- [ ] **Step 5: Commit the policy checks**

```bash
git add scripts/validate-repository.mjs scripts/tests/repository-validation.test.mjs
git commit -m "test: enforce repository release policies"
```

### Task 3: SHA-Pinned CI and Verified Pages Deployment

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: repository source and checked-in showcase inputs.
- Produces: the existing `validate` status check and a deployable GitHub Pages artifact containing only `docs/demo`.

- [ ] **Step 1: Pin CI actions**

Replace the mutable CI references with:

```yaml
- name: Check out repository
  uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
  with:
    persist-credentials: false
- name: Set up Node.js
  uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
  with:
    node-version: "22"
    package-manager-cache: false
```

- [ ] **Step 2: Add the Pages workflow**

Create `.github/workflows/pages.yml` with this structure and exact immutable refs:

```yaml
name: Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Check out repository
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          persist-credentials: false
      - name: Set up Node.js
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
        with:
          node-version: "22"
          package-manager-cache: false
      - name: Build verified demo
        run: npm run demo:build
      - name: Verify demo
        run: npm run demo:verify
      - name: Configure Pages
        uses: actions/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b # v5
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b # v4
        with:
          path: docs/demo

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    timeout-minutes: 10
    permissions:
      contents: read
      pages: write
      id-token: write
    steps:
      - name: Deploy Pages artifact
        id: deployment
        uses: actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e # v4
```

- [ ] **Step 3: Run repository validation**

Run: `npm run repository:validate`

Expected before Task 4: FAIL only for the missing Pages URL and obsolete ZIP; no workflow pin errors.

- [ ] **Step 4: Commit the workflows**

```bash
git add .github/workflows/ci.yml .github/workflows/pages.yml
git commit -m "ci: add verified Pages deployment"
```

### Task 4: Public Demo and Release Documentation Cleanup

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Delete: `create-visual-article-site-v2.0.0.zip`

**Interfaces:**
- Consumes: the approved Pages and v2.2.0 Release URLs.
- Produces: direct live-demo, release-download, and checksum links without committing generated binaries.

- [ ] **Step 1: Update the README links**

Add this call to action immediately after the introductory bilingual paragraph:

```markdown
[Open the live three-view demo / 在线体验三视图](https://shadow71833-sketch.github.io/create-visual-article-site/) · [Download v2.2.0](https://github.com/shadow71833-sketch/create-visual-article-site/releases/download/v2.2.0/create-visual-article-site-v2.2.0.zip) · [SHA-256](https://github.com/shadow71833-sketch/create-visual-article-site/releases/download/v2.2.0/create-visual-article-site-v2.2.0.zip.sha256)
```

Replace the checked-in-demo sentence with a live-demo link first and retain the offline `docs/demo/index.html` link as a secondary option. Add this exact maintainer example and state that the disposable directory prevents release artifacts from entering the working tree:

```bash
release_root="$(mktemp -d)"
npm run release:package -- \
  --repository . \
  --approved-root "$release_root" \
  --ref v2.2.0 \
  --output "$release_root/output"
```

- [ ] **Step 2: Document the hardening without changing the release version**

Add this section above `2.2.0` in `CHANGELOG.md`:

```markdown
## [Unreleased]

### Added

- Reproducible, tag-based ZIP packaging with SHA-256 evidence.
- Verified GitHub Pages deployment for the checked-in three-view showcase.

### Security

- Pinned every GitHub Action to an immutable commit SHA.
- Added repository validation for workflow pinning and stale release archives.
```

- [ ] **Step 3: Remove the obsolete archive**

Delete only `create-visual-article-site-v2.0.0.zip`, whose deletion the user explicitly approved. Do not remove tags, releases, source fixtures, or generated demo assets.

- [ ] **Step 4: Run complete validation**

Run: `npm run validate`

Expected: all tests PASS, repository validation returns `{"ok": true}`, and demo verification returns `{"ok": true}` with 3 views, 8 facts, 4 sections, 2 comic pages, 8 comic panels, and all coverage metrics equal to 1.

- [ ] **Step 5: Commit documentation and cleanup**

```bash
git add README.md CHANGELOG.md create-visual-article-site-v2.0.0.zip
git commit -m "docs: publish hardened release paths"
```

### Task 5: Reproducibility and Final Repository Evidence

**Files:**
- Verify only; no tracked file changes expected.

**Interfaces:**
- Consumes: completed Tasks 1–4 and annotated tag `v2.2.0`.
- Produces: fresh local evidence suitable for the pull request and external rollout plan.

- [ ] **Step 1: Run the complete project gate**

Run: `npm run validate`

Expected: zero test failures, repository `ok: true`, demo `ok: true`, and no warnings.

- [ ] **Step 2: Build the tagged release twice in disposable directories**

```bash
release_root_one="$(mktemp -d)"
release_root_two="$(mktemp -d)"
node scripts/package-release.mjs --repository . --approved-root "$release_root_one" --ref v2.2.0 --output "$release_root_one/output"
node scripts/package-release.mjs --repository . --approved-root "$release_root_two" --ref v2.2.0 --output "$release_root_two/output"
cmp "$release_root_one/output/create-visual-article-site-v2.2.0.zip" "$release_root_two/output/create-visual-article-site-v2.2.0.zip"
```

Expected: both package commands exit 0 and `cmp` exits 0.

- [ ] **Step 3: Verify checksum and archive boundaries**

```bash
cd "$release_root_one/output"
shasum -a 256 -c create-visual-article-site-v2.2.0.zip.sha256
unzip -Z1 create-visual-article-site-v2.2.0.zip
```

Expected: checksum reports `OK`; every path begins with `create-visual-article-site/`; no path begins with `.github/`, `docs/`, or `examples/`; no nested `.zip` file appears.

- [ ] **Step 4: Confirm a clean, reviewable branch**

Run: `git status --short --branch`

Expected: no untracked release artifact, no modified generated demo output, and the branch contains only the planned commits relative to `origin/main`.

Run: `git diff --check origin/main...HEAD`

Expected: exit 0 with no whitespace errors.
