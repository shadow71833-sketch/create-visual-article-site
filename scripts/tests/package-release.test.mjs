import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
import {inflateRawSync} from "node:zlib";

import {packageRelease} from "../package-release.mjs";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../package-release.mjs", import.meta.url));

const releaseFiles = new Map([
  ["CHANGELOG.md", "# Changelog\n"],
  ["CONTRIBUTING.md", "# Contributing\n"],
  ["LICENSE", "MIT License\n"],
  ["README.md", "# Create Visual Article Site\n"],
  ["SECURITY.md", "# Security\n"],
  ["SKILL.md", "---\nname: create-visual-article-site\n---\n"],
  ["agents/openai.yaml", "interface:\n  display_name: Visual Article\n"],
  ["assets/site-template/index.html", "<!doctype html><title>Template</title>\n"],
  ["package.json", '{"name":"create-visual-article-site","version":"2.2.0"}\n'],
  ["references/content-contract.md", "# Content contract\n"],
  ["scripts/build-site.mjs", "export function buildSite() {}\n"],
  [".github/workflows/ci.yml", "name: CI\n"],
  ["docs/demo/index.html", "<!doctype html><title>Demo</title>\n"],
  ["create-visual-article-site-v2.0.0.zip", "obsolete\n"],
]);

async function runGit(repositoryRoot, ...args) {
  return execFileAsync("git", ["-C", repositoryRoot, ...args], {encoding: "utf8"});
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "visual-article-release-test-"));
  const repositoryRoot = path.join(root, "repository");
  const approvedRoot = path.join(root, "approved");
  await mkdir(repositoryRoot);
  await mkdir(approvedRoot);
  await runGit(repositoryRoot, "init", "--quiet");

  for (const [relative, content] of releaseFiles) {
    const destination = path.join(repositoryRoot, relative);
    await mkdir(path.dirname(destination), {recursive: true});
    await writeFile(destination, content, "utf8");
  }

  await runGit(repositoryRoot, "add", ".");
  await runGit(
    repositoryRoot,
    "-c", "user.name=Release Test",
    "-c", "user.email=release-test@example.invalid",
    "commit", "--quiet", "-m", "release fixture",
  );
  await runGit(
    repositoryRoot,
    "-c", "user.name=Release Test",
    "-c", "user.email=release-test@example.invalid",
    "tag", "-a", "v2.2.0", "-m", "v2.2.0",
  );
  const {stdout} = await runGit(repositoryRoot, "rev-parse", "v2.2.0^{commit}");

  return {
    root,
    repositoryRoot,
    approvedRoot,
    commit: stdout.trim(),
    validOptions: {
      repositoryRoot,
      approvedRoot,
      ref: "v2.2.0",
      outputDirectory: path.join(approvedRoot, "output"),
    },
  };
}

function readCentralDirectoryNames(buffer) {
  const names = [];
  for (let offset = 0; offset <= buffer.length - 46;) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const filenameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const filenameStart = offset + 46;
    const filenameEnd = filenameStart + filenameLength;
    const recordEnd = filenameEnd + extraLength + commentLength;
    assert.ok(recordEnd <= buffer.length, "ZIP central-directory record must be complete");
    names.push(buffer.subarray(filenameStart, filenameEnd).toString("utf8"));
    offset = recordEnd;
  }
  return names;
}

function readZipEntry(buffer, expectedName) {
  for (let offset = 0; offset <= buffer.length - 46;) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const filenameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const filenameStart = offset + 46;
    const filenameEnd = filenameStart + filenameLength;
    const filename = buffer.subarray(filenameStart, filenameEnd).toString("utf8");
    if (filename === expectedName) {
      assert.equal(buffer.readUInt32LE(localHeaderOffset), 0x04034b50);
      const localFilenameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFilenameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      if (compressionMethod === 0) return compressed;
      if (compressionMethod === 8) return inflateRawSync(compressed);
      throw new Error(`unsupported ZIP compression method in test fixture: ${compressionMethod}`);
    }
    offset = filenameEnd + extraLength + commentLength;
  }
  throw new Error(`ZIP entry not found: ${expectedName}`);
}

test("packages an immutable release tag reproducibly", async () => {
  const fixture = await createFixture();
  try {
    const firstOutput = path.join(fixture.approvedRoot, "first");
    const secondOutput = path.join(fixture.approvedRoot, "second");
    const first = await packageRelease({...fixture.validOptions, outputDirectory: firstOutput});
    const second = await packageRelease({...fixture.validOptions, outputDirectory: secondOutput});

    assert.equal(first.sha256, second.sha256);
    assert.equal(first.commit, fixture.commit);
    assert.equal(
      first.sha256,
      createHash("sha256").update(await readFile(first.archivePath)).digest("hex"),
    );
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
    assert.deepEqual((await readdir(firstOutput)).sort(), [
      "create-visual-article-site-v2.2.0.zip",
      "create-visual-article-site-v2.2.0.zip.sha256",
    ]);
    assert.deepEqual(await readdir(fixture.approvedRoot), ["first", "second"]);
  } finally {
    await rm(fixture.root, {recursive: true, force: true});
  }
});

test("isolates archive attributes from source Git metadata, config, and inherited Git environment", async () => {
  const fixture = await createFixture();
  const inheritedKeys = ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"];
  const inheritedValues = new Map(inheritedKeys.map((key) => [key, process.env[key]]));
  try {
    const first = await packageRelease({
      ...fixture.validOptions,
      outputDirectory: path.join(fixture.approvedRoot, "before-attributes"),
    });
    const {stdout: gitDirectoryOutput} = await runGit(fixture.repositoryRoot, "rev-parse", "--absolute-git-dir");
    const gitDirectory = gitDirectoryOutput.trim();
    const configuredAttributes = path.join(fixture.root, "configured-attributes");
    const inheritedAttributes = path.join(fixture.root, "inherited-attributes");
    await writeFile(
      path.join(gitDirectory, "info", "attributes"),
      "README.md export-ignore\nSKILL.md export-subst\n",
      "utf8",
    );
    await writeFile(
      configuredAttributes,
      "package.json export-ignore\nCHANGELOG.md export-subst\n",
      "utf8",
    );
    await writeFile(
      inheritedAttributes,
      "SECURITY.md export-ignore\nCONTRIBUTING.md export-subst\n",
      "utf8",
    );
    await runGit(fixture.repositoryRoot, "config", "core.attributesFile", configuredAttributes);
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "core.attributesFile";
    process.env.GIT_CONFIG_VALUE_0 = inheritedAttributes;

    const second = await packageRelease({
      ...fixture.validOptions,
      outputDirectory: path.join(fixture.approvedRoot, "after-attributes"),
    });
    assert.equal(second.commit, first.commit);
    assert.equal(second.sha256, first.sha256);
    assert.deepEqual(
      readCentralDirectoryNames(await readFile(second.archivePath)),
      readCentralDirectoryNames(await readFile(first.archivePath)),
    );
  } finally {
    for (const [key, value] of inheritedValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(fixture.root, {recursive: true, force: true});
  }
});

test("preserves tracked gitattributes export-subst behavior in the isolated archive", async () => {
  const fixture = await createFixture();
  try {
    await writeFile(path.join(fixture.repositoryRoot, ".gitattributes"), "README.md export-subst\n", "utf8");
    await writeFile(
      path.join(fixture.repositoryRoot, "README.md"),
      "# Tagged release $Format:%H$\n",
      "utf8",
    );
    await runGit(fixture.repositoryRoot, "add", ".gitattributes", "README.md");
    await runGit(
      fixture.repositoryRoot,
      "-c", "user.name=Release Test",
      "-c", "user.email=release-test@example.invalid",
      "commit", "--quiet", "-m", "add tracked archive attributes",
    );
    await runGit(
      fixture.repositoryRoot,
      "-c", "user.name=Release Test",
      "-c", "user.email=release-test@example.invalid",
      "tag", "-a", "v2.3.0", "-m", "v2.3.0",
    );
    const {stdout: commitOutput} = await runGit(fixture.repositoryRoot, "rev-parse", "v2.3.0^{commit}");
    const commit = commitOutput.trim();

    const result = await packageRelease({
      ...fixture.validOptions,
      ref: "v2.3.0",
      outputDirectory: path.join(fixture.approvedRoot, "tracked-attributes"),
    });
    assert.equal(
      readZipEntry(
        await readFile(result.archivePath),
        "create-visual-article-site/README.md",
      ).toString("utf8"),
      `# Tagged release ${commit}\n`,
    );
  } finally {
    await rm(fixture.root, {recursive: true, force: true});
  }
});

test("requires the exact annotated tag ref instead of a same-named branch or lightweight tag", async () => {
  const fixture = await createFixture();
  try {
    await runGit(fixture.repositoryRoot, "tag", "-d", "v2.2.0");
    await runGit(fixture.repositoryRoot, "branch", "v2.2.0");
    await assert.rejects(
      packageRelease(fixture.validOptions),
      /git command failed/,
    );

    await runGit(fixture.repositoryRoot, "branch", "-D", "v2.2.0");
    await runGit(fixture.repositoryRoot, "tag", "v2.2.0");
    await assert.rejects(
      packageRelease(fixture.validOptions),
      /annotated tag/,
    );
    assert.deepEqual(await readdir(fixture.approvedRoot), []);
  } finally {
    await rm(fixture.root, {recursive: true, force: true});
  }
});

test("rejects tagged symlinks and submodules before archiving", async () => {
  const fixture = await createFixture();
  try {
    const symlinkPath = path.join(fixture.repositoryRoot, "scripts", "release-link.mjs");
    await symlink("../README.md", symlinkPath);
    await runGit(fixture.repositoryRoot, "add", "scripts/release-link.mjs");
    await runGit(
      fixture.repositoryRoot,
      "-c", "user.name=Release Test",
      "-c", "user.email=release-test@example.invalid",
      "commit", "--quiet", "-m", "add tagged symlink",
    );
    await runGit(
      fixture.repositoryRoot,
      "-c", "user.name=Release Test",
      "-c", "user.email=release-test@example.invalid",
      "tag", "-a", "v2.2.1", "-m", "v2.2.1",
    );
    await assert.rejects(
      packageRelease({
        ...fixture.validOptions,
        ref: "v2.2.1",
        outputDirectory: path.join(fixture.approvedRoot, "symlink-output"),
      }),
      /symbolic link.*scripts\/release-link\.mjs/,
    );

    await runGit(fixture.repositoryRoot, "rm", "--quiet", "scripts/release-link.mjs");
    await runGit(
      fixture.repositoryRoot,
      "update-index", "--add", "--cacheinfo",
      `160000,${fixture.commit},agents/nested-repository`,
    );
    await runGit(
      fixture.repositoryRoot,
      "-c", "user.name=Release Test",
      "-c", "user.email=release-test@example.invalid",
      "commit", "--quiet", "-m", "add tagged submodule",
    );
    await runGit(
      fixture.repositoryRoot,
      "-c", "user.name=Release Test",
      "-c", "user.email=release-test@example.invalid",
      "tag", "-a", "v2.2.2", "-m", "v2.2.2",
    );
    await assert.rejects(
      packageRelease({
        ...fixture.validOptions,
        ref: "v2.2.2",
        outputDirectory: path.join(fixture.approvedRoot, "submodule-output"),
      }),
      /submodule.*agents\/nested-repository/,
    );
    assert.deepEqual(await readdir(fixture.approvedRoot), []);
  } finally {
    await rm(fixture.root, {recursive: true, force: true});
  }
});

test("keeps archive content and metadata bound to the initially resolved tag commit", async () => {
  const fixture = await createFixture();
  const originalPath = process.env.PATH;
  try {
    const originalReadme = releaseFiles.get("README.md");
    await writeFile(path.join(fixture.repositoryRoot, "README.md"), "# Mutated after tag resolution\n", "utf8");
    await runGit(fixture.repositoryRoot, "add", "README.md");
    await runGit(
      fixture.repositoryRoot,
      "-c", "user.name=Release Test",
      "-c", "user.email=release-test@example.invalid",
      "commit", "--quiet", "-m", "post-tag mutation",
    );
    const {stdout: mutableCommitOutput} = await runGit(fixture.repositoryRoot, "rev-parse", "HEAD");
    const mutableCommit = mutableCommitOutput.trim();
    const {stdout: gitPathOutput} = await execFileAsync("which", ["git"], {encoding: "utf8"});
    const realGit = gitPathOutput.trim();
    const wrapperDirectory = path.join(fixture.root, "git-wrapper");
    const wrapperPath = path.join(wrapperDirectory, "git");
    const markerPath = path.join(wrapperDirectory, "mutated");
    await mkdir(wrapperDirectory);
    await writeFile(wrapperPath, `#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {writeFileSync} from "node:fs";
const args = process.argv.slice(2);
const result = spawnSync(${JSON.stringify(realGit)}, args, {encoding: "buffer"});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status === 0 && args.includes("rev-parse") && args.includes("refs/tags/v2.2.0")) {
  try {
    writeFileSync(${JSON.stringify(markerPath)}, "mutated\\n", {flag: "wx"});
    const update = spawnSync(${JSON.stringify(realGit)}, ["-C", ${JSON.stringify(fixture.repositoryRoot)}, "tag", "-f", "v2.2.0", ${JSON.stringify(mutableCommit)}], {encoding: "buffer"});
    if (update.status !== 0) {
      if (update.stderr) process.stderr.write(update.stderr);
      process.exit(update.status ?? 1);
    }
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}
process.exit(result.status ?? 1);
`, "utf8");
    await chmod(wrapperPath, 0o755);
    process.env.PATH = `${wrapperDirectory}${path.delimiter}${originalPath}`;

    const result = await packageRelease(fixture.validOptions);
    const archive = await readFile(result.archivePath);
    assert.equal(result.commit, fixture.commit);
    assert.equal(
      readZipEntry(archive, "create-visual-article-site/README.md").toString("utf8"),
      originalReadme,
    );
    const {stdout: movedTagOutput} = await runGit(fixture.repositoryRoot, "rev-parse", "refs/tags/v2.2.0^{commit}");
    assert.equal(movedTagOutput.trim(), mutableCommit);
  } finally {
    process.env.PATH = originalPath;
    await rm(fixture.root, {recursive: true, force: true});
  }
});

test("requires the published output directory to be a direct child of the approved root", async () => {
  const fixture = await createFixture();
  try {
    const nestedParent = path.join(fixture.approvedRoot, "nested");
    const nestedOutput = path.join(nestedParent, "output");
    await mkdir(nestedParent);
    await assert.rejects(
      packageRelease({...fixture.validOptions, outputDirectory: nestedOutput}),
      /direct child of the approved root/,
    );
    await assert.rejects(lstat(nestedOutput), {code: "ENOENT"});
    assert.deepEqual(await readdir(fixture.approvedRoot), ["nested"]);
  } finally {
    await rm(fixture.root, {recursive: true, force: true});
  }
});

test("refuses to clean up a staging path whose directory identity changed", async () => {
  const fixture = await createFixture();
  const originalPath = process.env.PATH;
  try {
    const {stdout: gitPathOutput} = await execFileAsync("which", ["git"], {encoding: "utf8"});
    const realGit = gitPathOutput.trim();
    const wrapperDirectory = path.join(fixture.root, "identity-wrapper");
    const wrapperPath = path.join(wrapperDirectory, "git");
    await mkdir(wrapperDirectory);
    await writeFile(wrapperPath, `#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {mkdirSync, readdirSync, renameSync, writeFileSync} from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const result = spawnSync(${JSON.stringify(realGit)}, args, {encoding: "buffer"});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status === 0 && args.includes("archive")) {
  const stagingName = readdirSync(${JSON.stringify(fixture.approvedRoot)}).find((name) => name.startsWith(".package-release-"));
  if (!stagingName) throw new Error("staging directory not found");
  const stagingPath = path.join(${JSON.stringify(fixture.approvedRoot)}, stagingName);
  renameSync(stagingPath, path.join(${JSON.stringify(fixture.root)}, "original-staging"));
  mkdirSync(stagingPath, {mode: 0o700});
  writeFileSync(path.join(stagingPath, "attacker-owned"), "do not remove\\n");
}
process.exit(result.status ?? 1);
`, "utf8");
    await chmod(wrapperPath, 0o755);
    process.env.PATH = `${wrapperDirectory}${path.delimiter}${originalPath}`;

    await assert.rejects(
      packageRelease(fixture.validOptions),
      /staging cleanup was refused/,
    );
    const replacementName = (await readdir(fixture.approvedRoot)).find((name) => name.startsWith(".package-release-"));
    assert.ok(replacementName);
    assert.equal(
      await readFile(path.join(fixture.approvedRoot, replacementName, "attacker-owned"), "utf8"),
      "do not remove\n",
    );
    await assert.rejects(lstat(fixture.validOptions.outputDirectory), {code: "ENOENT"});
  } finally {
    process.env.PATH = originalPath;
    await rm(fixture.root, {recursive: true, force: true});
  }
});

test("rejects invalid refs, output escapes, symlink roots, and existing destinations", async () => {
  const fixture = await createFixture();
  try {
    const repositorySymlink = path.join(fixture.root, "repository-link");
    const approvedSymlink = path.join(fixture.root, "approved-link");
    await symlink(fixture.repositoryRoot, repositorySymlink);
    await symlink(fixture.approvedRoot, approvedSymlink);

    await assert.rejects(packageRelease({...fixture.validOptions, ref: "main"}), /release ref must match/);
    await assert.rejects(
      packageRelease({...fixture.validOptions, outputDirectory: path.join(fixture.root, "outside")}),
      /approved root/,
    );
    await assert.rejects(
      packageRelease({...fixture.validOptions, repositoryRoot: repositorySymlink}),
      /repository root must be a regular directory/,
    );
    await assert.rejects(
      packageRelease({
        ...fixture.validOptions,
        approvedRoot: approvedSymlink,
        outputDirectory: path.join(approvedSymlink, "output"),
      }),
      /approved root must be a regular directory/,
    );

    await mkdir(fixture.validOptions.outputDirectory);
    await assert.rejects(packageRelease(fixture.validOptions), /output directory already exists/);
  } finally {
    await rm(fixture.root, {recursive: true, force: true});
  }
});

test("cleans up a newly created destination when git archive fails", async () => {
  const fixture = await createFixture();
  try {
    await runGit(fixture.repositoryRoot, "rm", "--quiet", "CHANGELOG.md");
    await runGit(
      fixture.repositoryRoot,
      "-c", "user.name=Release Test",
      "-c", "user.email=release-test@example.invalid",
      "commit", "--quiet", "-m", "remove required release file",
    );
    await runGit(
      fixture.repositoryRoot,
      "-c", "user.name=Release Test",
      "-c", "user.email=release-test@example.invalid",
      "tag", "-a", "v9.9.9", "-m", "incomplete release",
    );

    const outputDirectory = path.join(fixture.approvedRoot, "failed");
    await assert.rejects(
      packageRelease({...fixture.validOptions, ref: "v9.9.9", outputDirectory}),
      /git command failed/,
    );
    await assert.rejects(lstat(outputDirectory), {code: "ENOENT"});
    assert.deepEqual(await readdir(fixture.approvedRoot), []);
  } finally {
    await rm(fixture.root, {recursive: true, force: true});
  }
});

test("prints CLI metadata and rejects unknown flags without creating output", async () => {
  const fixture = await createFixture();
  try {
    const outputDirectory = path.join(fixture.approvedRoot, "cli-output");
    const {stdout} = await execFileAsync(process.execPath, [
      cliPath,
      "--repository", fixture.repositoryRoot,
      "--approved-root", fixture.approvedRoot,
      "--ref", "v2.2.0",
      "--output", outputDirectory,
    ], {encoding: "utf8"});
    const metadata = JSON.parse(stdout);
    assert.equal(metadata.commit, fixture.commit);
    assert.equal(metadata.archivePath, path.join(outputDirectory, "create-visual-article-site-v2.2.0.zip"));
    assert.equal(metadata.checksumPath, `${metadata.archivePath}.sha256`);

    const rejectedOutput = path.join(fixture.approvedRoot, "rejected-output");
    await assert.rejects(
      execFileAsync(process.execPath, [cliPath, "--unknown", rejectedOutput], {encoding: "utf8"}),
      (error) => error.code === 1 && /unknown flag: --unknown/.test(error.stderr),
    );
    await assert.rejects(lstat(rejectedOutput), {code: "ENOENT"});
  } finally {
    await rm(fixture.root, {recursive: true, force: true});
  }
});
