# GitHub Release Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the hardened repository changes through a reviewed pull request, deploy the verified demo to GitHub Pages, enable repository security controls, protect `main`, restrict Actions, and attach reproducible v2.2.0 release assets.

**Architecture:** Roll out external state only after the repository-side pull request passes CI and merges. Enable Pages before dispatching the deployment, enable security controls independently so failures are isolated, and apply branch protection last so the maintainer cannot be locked out during setup. Keep administrator bypass enabled because this is a single-maintainer repository, while requiring normal changes to use a pull request and the `validate` status check.

**Tech Stack:** GitHub CLI 2.x, GitHub REST API version `2026-03-10`, GitHub Actions, GitHub Pages, Git, Node.js 22+, POSIX shell tools `curl`, `shasum`, `cmp`, and `unzip`.

## Global Constraints

- Never print, store, or pass OAuth tokens, cookies, or credentials as command arguments.
- Use the existing authenticated `gh` session; all API mutations target only `shadow71833-sketch/create-visual-article-site`.
- Do not move or recreate the annotated tag `v2.2.0`.
- Do not merge until the pull request `validate` check succeeds on the latest head SHA.
- Do not delete the remote feature branch during rollout; preserve it for traceability unless the user later requests deletion.
- Enable administrator bypass for branch protection (`enforce_admins: false`) because the repository has one maintainer.
- Require pull requests, an up-to-date `validate` check, resolved conversations, no force pushes, and no branch deletion for non-admin changes to `main`.
- Allow only GitHub-owned Actions; keep third-party and all verified-creator Actions disabled.
- Build and upload release assets from the immutable `v2.2.0` tag using the repository packager; never upload an archive built from `main`.
- Verify every external mutation with a fresh read-only API call before proceeding.

---

## External State Map

- Pull request: transports repository hardening from `codex/release-hardening-v2.2.0` to `main`.
- GitHub Pages: uses workflow publishing and serves `https://shadow71833-sketch.github.io/create-visual-article-site/`.
- Repository metadata: sets the Pages URL as `homepage`.
- Security settings: private vulnerability reporting, secret scanning, push protection, validity checks, non-provider-pattern scanning, and Dependabot security updates.
- Actions permissions: `allowed_actions=selected`, GitHub-owned allowed, verified creators and custom patterns disallowed, default workflow token read-only.
- Branch protection: pull request gate, strict `validate` check, resolved conversations, and destructive-update prevention.
- Release `v2.2.0`: attaches `create-visual-article-site-v2.2.0.zip` and its `.sha256` sidecar.

### Task 1: Publish and Review the Repository Hardening Pull Request

**Files:**
- Consumes the completed branch from `2026-08-25-repository-release-hardening.md`.
- No new file changes are expected.

**Interfaces:**
- Consumes: local branch `codex/release-hardening-v2.2.0` with a clean worktree and passing `npm run validate`.
- Produces: an open pull request targeting `main` with passing `validate` CI.

- [ ] **Step 1: Re-run the complete local gate**

Run: `npm run validate`

Expected: zero test failures, repository `ok: true`, demo `ok: true`, and all coverage metrics equal to 1.

- [ ] **Step 2: Confirm branch scope and credentials without exposing secrets**

```bash
git status --short --branch
git log --oneline origin/main..HEAD
gh auth status
```

Expected: the worktree is clean, only planned hardening commits are listed, and `gh auth status` reports the `repo` and `workflow` scopes without printing a token.

- [ ] **Step 3: Push through the GitHub CLI credential helper override**

```bash
git -c credential.helper= -c 'credential.https://github.com.helper=!gh auth git-credential' push --set-upstream origin codex/release-hardening-v2.2.0
```

Expected: the remote branch is created without changing global Git credential configuration.

- [ ] **Step 4: Create the pull request**

```bash
gh pr create \
  --base main \
  --head codex/release-hardening-v2.2.0 \
  --title "Harden release packaging and publish verified Pages demo" \
  --body "Adds reproducible tag-based ZIP packaging, SHA-pinned Actions, verified GitHub Pages deployment, repository policy regressions, live-demo documentation, and removal of the obsolete v2.0.0 archive. Validation: npm run validate."
```

Expected: one non-draft pull request URL in `shadow71833-sketch/create-visual-article-site`.

- [ ] **Step 5: Wait for the exact required check**

Run: `gh pr checks --watch --interval 10 --fail-fast`

Expected: `validate` completes with `SUCCESS` on the latest pull request head SHA.

### Task 2: Merge and Enable GitHub Pages

**Files:**
- External GitHub state only.

**Interfaces:**
- Consumes: a mergeable pull request with successful `validate` CI.
- Produces: merged `main`, a workflow-backed Pages site, and repository homepage metadata.

- [ ] **Step 1: Reconfirm the merge gate**

```bash
gh pr view --json number,state,isDraft,mergeable,headRefOid,statusCheckRollup,url
```

Expected: `state` is `OPEN`, `isDraft` is false, `mergeable` is `MERGEABLE`, and `validate` has conclusion `SUCCESS` for `headRefOid`.

- [ ] **Step 2: Merge without deleting the source branch**

Run: `gh pr merge --merge`

Expected: exit 0; `gh pr view --json state,mergedAt,mergeCommit,url` reports `MERGED` and a non-null merge commit.

- [ ] **Step 3: Enable workflow-based Pages publishing**

Run: `gh api --method POST repos/shadow71833-sketch/create-visual-article-site/pages -f build_type=workflow`

Expected: HTTP 201 and a Pages object whose `build_type` is `workflow`. If the endpoint returns HTTP 409 because Pages already exists, read the current object and run `gh api --method PUT repos/shadow71833-sketch/create-visual-article-site/pages -f build_type=workflow` only when its build type differs.

- [ ] **Step 4: Set the public homepage**

```bash
gh api --method PATCH repos/shadow71833-sketch/create-visual-article-site \
  -f homepage=https://shadow71833-sketch.github.io/create-visual-article-site/
```

Expected: the returned repository object contains the exact homepage URL.

- [ ] **Step 5: Dispatch and watch Pages after it is enabled**

```bash
gh workflow run pages.yml --ref main
pages_run_id="$(gh run list --workflow pages.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$pages_run_id" --exit-status --interval 10
```

Expected: both `build` and `deploy` succeed for the current `main` SHA.

- [ ] **Step 6: Verify the public Pages site**

```bash
curl --fail --silent --show-error --location --retry 5 --retry-delay 5 \
  https://shadow71833-sketch.github.io/create-visual-article-site/ \
  | grep -F 'data-view="reading"'
```

Expected: exit 0 and the deployed HTML contains the reading-view marker. Repeat with `data-view="onepage"` and `data-view="comic"`.

### Task 3: Enable Repository Security Controls

**Files:**
- External GitHub state only.

**Interfaces:**
- Consumes: administrator access to the public repository.
- Produces: private vulnerability reporting, secret-scanning protections, and Dependabot security updates.

- [ ] **Step 1: Enable private vulnerability reporting**

Run: `gh api --method PUT repos/shadow71833-sketch/create-visual-article-site/private-vulnerability-reporting`

Expected: HTTP 204. Verify with `gh api repos/shadow71833-sketch/create-visual-article-site/private-vulnerability-reporting`; expected JSON is `{"enabled":true}`.

- [ ] **Step 2: Enable secret scanning and push protection**

```bash
gh api --method PATCH repos/shadow71833-sketch/create-visual-article-site --input - <<'JSON'
{
  "security_and_analysis": {
    "secret_scanning": {"status": "enabled"},
    "secret_scanning_push_protection": {"status": "enabled"},
    "secret_scanning_validity_checks": {"status": "enabled"},
    "secret_scanning_non_provider_patterns": {"status": "enabled"}
  }
}
JSON
```

Expected: the returned `security_and_analysis` object reports `enabled` for all four requested settings. If one optional feature returns HTTP 422 because it is unavailable for this account, enable `secret_scanning` and `secret_scanning_push_protection` in a reduced request, report the unsupported optional feature, and do not claim it is enabled.

- [ ] **Step 3: Enable Dependabot security updates**

Run: `gh api --method PUT repos/shadow71833-sketch/create-visual-article-site/automated-security-fixes`

Expected: HTTP 204. Verify with `gh api repos/shadow71833-sketch/create-visual-article-site/automated-security-fixes`; expected JSON includes `"enabled": true` and `"paused": false`.

- [ ] **Step 4: Verify the complete security state**

```bash
gh api repos/shadow71833-sketch/create-visual-article-site \
  --jq '{security_and_analysis}'
gh api repos/shadow71833-sketch/create-visual-article-site/private-vulnerability-reporting
gh api repos/shadow71833-sketch/create-visual-article-site/automated-security-fixes
```

Expected: every supported requested control is enabled; no credential-shaped output appears.

### Task 4: Restrict GitHub Actions Permissions

**Files:**
- External GitHub state only.

**Interfaces:**
- Consumes: repository workflows that use only GitHub-owned Actions pinned to full commit SHAs.
- Produces: selected-actions policy allowing GitHub-owned Actions only and a read-only default workflow token.

- [ ] **Step 1: Confirm every action is GitHub-owned and SHA-pinned**

Run: `npm run repository:validate`

Expected: `{"ok": true}` and no mutable action refs.

- [ ] **Step 2: Switch the repository to selected Actions**

```bash
gh api --method PUT repos/shadow71833-sketch/create-visual-article-site/actions/permissions \
  -F enabled=true \
  -f allowed_actions=selected
```

Expected: HTTP 204.

- [ ] **Step 3: Allow only GitHub-owned Actions**

```bash
gh api --method PUT repos/shadow71833-sketch/create-visual-article-site/actions/permissions/selected-actions --input - <<'JSON'
{
  "github_owned_allowed": true,
  "verified_allowed": false,
  "patterns_allowed": []
}
JSON
```

Expected: HTTP 204.

- [ ] **Step 4: Keep the default workflow token read-only**

```bash
gh api --method PUT repos/shadow71833-sketch/create-visual-article-site/actions/permissions/workflow --input - <<'JSON'
{
  "default_workflow_permissions": "read",
  "can_approve_pull_request_reviews": false
}
JSON
```

Expected: HTTP 204. Explicit job-level Pages permissions remain effective.

- [ ] **Step 5: Verify Actions policy and re-run CI**

```bash
gh api repos/shadow71833-sketch/create-visual-article-site/actions/permissions
gh api repos/shadow71833-sketch/create-visual-article-site/actions/permissions/selected-actions
gh api repos/shadow71833-sketch/create-visual-article-site/actions/permissions/workflow
gh workflow run ci.yml --ref main
ci_run_id="$(gh run list --workflow ci.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$ci_run_id" --exit-status --interval 10
```

Expected: `allowed_actions` is `selected`, only GitHub-owned Actions are allowed, default permissions are `read`, and CI succeeds.

### Task 5: Protect the Main Branch

**Files:**
- External GitHub state only.

**Interfaces:**
- Consumes: a recently successful `validate` check from GitHub Actions.
- Produces: branch protection requiring normal changes to use a current PR with successful validation while retaining admin recovery access.

- [ ] **Step 1: Apply exact protection settings**

```bash
gh api --method PUT repos/shadow71833-sketch/create-visual-article-site/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "checks": [{"context": "validate"}]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": true
}
JSON
```

Expected: HTTP 200.

- [ ] **Step 2: Verify protection without attempting a destructive push**

```bash
gh api repos/shadow71833-sketch/create-visual-article-site/branches/main/protection \
  --jq '{required_status_checks,enforce_admins,required_pull_request_reviews,required_conversation_resolution,allow_force_pushes,allow_deletions}'
```

Expected: strict status checks include `validate`; admin enforcement is disabled; pull request review protection exists with zero required approvals; conversation resolution is enabled; force pushes and deletions are disabled.

### Task 6: Attach Reproducible v2.2.0 Release Assets

**Files:**
- External Release assets only; artifacts stay in disposable directories.

**Interfaces:**
- Consumes: `scripts/package-release.mjs` from merged `main` and immutable tag `v2.2.0` at `c50069c2dfe69ac24c4c92ffd4842a95ce26d972`.
- Produces: two downloadable assets on the existing formal v2.2.0 Release.

- [ ] **Step 1: Confirm tag immutability and fetch merged main**

```bash
git fetch origin main --tags
git rev-parse 'v2.2.0^{}'
git merge-base --is-ancestor 'v2.2.0^{}' origin/main
```

Expected: the dereferenced tag is `c50069c2dfe69ac24c4c92ffd4842a95ce26d972` and the ancestor check exits 0.

- [ ] **Step 2: Build in a disposable directory**

```bash
release_root="$(mktemp -d)"
node scripts/package-release.mjs \
  --repository . \
  --approved-root "$release_root" \
  --ref v2.2.0 \
  --output "$release_root/output"
```

Expected: the JSON result identifies the exact tag commit and two files under `$release_root/output`.

- [ ] **Step 3: Verify locally before upload**

```bash
cd "$release_root/output"
shasum -a 256 -c create-visual-article-site-v2.2.0.zip.sha256
unzip -Z1 create-visual-article-site-v2.2.0.zip
```

Expected: checksum `OK`; only approved `create-visual-article-site/` paths appear.

- [ ] **Step 4: Upload both assets to the existing Release**

```bash
gh release upload v2.2.0 \
  "$release_root/output/create-visual-article-site-v2.2.0.zip" \
  "$release_root/output/create-visual-article-site-v2.2.0.zip.sha256" \
  --clobber
```

Expected: exit 0; the Release remains non-draft and non-prerelease.

- [ ] **Step 5: Download and verify the public assets independently**

```bash
download_root="$(mktemp -d)"
gh release download v2.2.0 \
  --pattern 'create-visual-article-site-v2.2.0.zip*' \
  --dir "$download_root"
cd "$download_root"
shasum -a 256 -c create-visual-article-site-v2.2.0.zip.sha256
```

Expected: both assets download and checksum verification reports `OK`.

### Task 7: Final Public-State Audit

**Files:**
- Verify only; no state changes expected.

**Interfaces:**
- Consumes: completed Tasks 1–6.
- Produces: evidence-backed completion report with URLs and any unsupported optional GitHub controls clearly identified.

- [ ] **Step 1: Verify pull request, CI, and Pages runs**

```bash
gh pr view --json number,state,mergedAt,mergeCommit,url
gh run list --branch main --limit 5 --json workflowName,status,conclusion,headSha,url
gh api repos/shadow71833-sketch/create-visual-article-site/pages --jq '{html_url,build_type,status,https_enforced}'
```

Expected: PR merged; newest CI and Pages runs succeed for `main`; Pages uses workflow publishing and HTTPS.

- [ ] **Step 2: Verify public HTTP content and repository metadata**

```bash
curl --fail --silent --show-error --location https://shadow71833-sketch.github.io/create-visual-article-site/ | grep -F 'data-view="comic"'
gh api repos/shadow71833-sketch/create-visual-article-site --jq '{homepage,default_branch,security_and_analysis}'
```

Expected: the site contains all three views and the homepage is the exact Pages URL.

- [ ] **Step 3: Verify security, Actions, and branch protection**

```bash
gh api repos/shadow71833-sketch/create-visual-article-site/private-vulnerability-reporting
gh api repos/shadow71833-sketch/create-visual-article-site/automated-security-fixes
gh api repos/shadow71833-sketch/create-visual-article-site/actions/permissions
gh api repos/shadow71833-sketch/create-visual-article-site/actions/permissions/selected-actions
gh api repos/shadow71833-sketch/create-visual-article-site/branches/main/protection
```

Expected: all supported requested security controls are enabled, Actions are restricted, and `main` protection matches Task 5.

- [ ] **Step 4: Verify the formal Release and assets**

```bash
gh release view v2.2.0 --json name,tagName,url,isDraft,isPrerelease,publishedAt,assets
git ls-remote --heads origin main codex/release-hardening-v2.2.0
git ls-remote --tags origin refs/tags/v2.2.0 'refs/tags/v2.2.0^{}'
```

Expected: formal v2.2.0 Release with exactly the ZIP and checksum assets; tag dereferences to `c50069c2dfe69ac24c4c92ffd4842a95ce26d972`; the feature branch remains available.

- [ ] **Step 5: Confirm local cleanliness**

Run: `git status --short --branch`

Expected: no tracked or untracked release artifacts and no modified generated demo files.
