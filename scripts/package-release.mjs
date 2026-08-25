import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {constants as fsConstants} from "node:fs";
import {chmod, lstat, mkdir, mkdtemp, open, rename, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";

import {
  assertApprovedDescendant,
  assertNoSymlinkWithin,
} from "./lib/security.mjs";

const RELEASE_REF = /^v\d+\.\d+\.\d+$/;
const RELEASE_PATHS = Object.freeze([
  "SKILL.md",
  "agents",
  "assets",
  "references",
  "scripts",
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
]);
const CLI_FLAGS = new Set(["--repository", "--approved-root", "--ref", "--output"]);
const CLI_USAGE = "Usage: node scripts/package-release.mjs --repository <dir> --approved-root <dir> --ref <vX.Y.Z> --output <dir>";
const OBJECT_IDENTIFIER = /^[a-f0-9]{40,64}$/i;
const REGULAR_BLOB_MODES = new Set(["100644", "100755"]);

function requirePath(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty path`);
  }
  return path.resolve(value);
}

async function assertRegularDirectory(value, label) {
  const resolved = requirePath(value, label);
  let metadata;
  try {
    metadata = await lstat(resolved);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new TypeError(`${label} must be an existing regular directory`);
    }
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new TypeError(`${label} must be a regular directory`);
  }
  return resolved;
}

async function pathMetadata(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function cleanGitEnvironment(overrides = {}) {
  const environment = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!/^GIT_/i.test(name)) environment[name] = value;
  }
  return {
    ...environment,
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    ...overrides,
  };
}

function runGit(repositoryRoot, args, environment = cleanGitEnvironment()) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repositoryRoot, ...args], {
      env: environment,
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

function runGitToFile(
  repositoryRoot,
  args,
  outputFileDescriptor,
  environment = cleanGitEnvironment(),
) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repositoryRoot, ...args], {
      env: environment,
      shell: false,
      stdio: ["ignore", outputFileDescriptor, "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git command failed with exit code ${code}: ${stderr.trim()}`));
    });
  });
}

function assertObjectIdentifier(value, label) {
  if (!OBJECT_IDENTIFIER.test(value)) {
    throw new Error(`git returned an invalid ${label} identifier`);
  }
  return value;
}

async function resolveAnnotatedReleaseTag(repositoryRoot, ref) {
  const exactTagRef = `refs/tags/${ref}`;
  const tagObject = assertObjectIdentifier(
    await runGit(repositoryRoot, ["rev-parse", "--verify", exactTagRef]),
    "release tag object",
  );
  const objectType = await runGit(repositoryRoot, ["cat-file", "-t", tagObject]);
  if (objectType !== "tag") {
    throw new Error(`release ref must resolve to an annotated tag: ${exactTagRef}`);
  }
  const commit = assertObjectIdentifier(
    await runGit(repositoryRoot, ["rev-parse", "--verify", `${tagObject}^{commit}`]),
    "release commit",
  );
  return {commit, tagObject};
}

async function assertSafeReleaseTree(repositoryRoot, commit) {
  const tree = await runGit(repositoryRoot, [
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    commit,
    "--",
    ...RELEASE_PATHS,
  ]);
  for (const record of tree.split("\0")) {
    if (record.length === 0) continue;
    const match = /^(\d{6}) ([^ ]+) ([a-f0-9]{40,64})\t([\s\S]+)$/i.exec(record);
    if (!match) throw new Error("git returned an invalid release tree entry");
    const [, mode, type, , relativePath] = match;
    if (mode === "120000") {
      throw new Error(`release tree contains a symbolic link: ${relativePath}`);
    }
    if (mode === "160000" || type === "commit") {
      throw new Error(`release tree contains a submodule: ${relativePath}`);
    }
    if (type !== "blob" || !REGULAR_BLOB_MODES.has(mode)) {
      throw new Error(`release tree contains a non-regular file (${mode} ${type}): ${relativePath}`);
    }
  }
}

function alternateObjectDirectoryValue(objectDirectory) {
  if (objectDirectory.includes("\0")) {
    throw new Error("repository object database path contains a null byte");
  }
  return objectDirectory.includes(path.delimiter)
    ? JSON.stringify(objectDirectory)
    : objectDirectory;
}

async function createIsolatedArchiveRepository(repositoryRoot, stagingPath) {
  const objectDirectory = await runGit(repositoryRoot, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "objects",
  ]);
  if (!path.isAbsolute(objectDirectory)) {
    throw new Error("git returned a non-absolute repository object database path");
  }
  const objectFormat = await runGit(repositoryRoot, ["rev-parse", "--show-object-format"]);
  if (objectFormat !== "sha1" && objectFormat !== "sha256") {
    throw new Error(`git returned an unsupported object format: ${objectFormat}`);
  }

  const isolationRoot = path.join(stagingPath, ".git-archive-isolation");
  const emptyTemplate = path.join(isolationRoot, "empty-template");
  const isolatedRepository = path.join(isolationRoot, "repository.git");
  await mkdir(isolationRoot, {mode: 0o700});
  const isolationIdentity = await lstat(isolationRoot);
  await mkdir(emptyTemplate, {mode: 0o700});
  await runGit(stagingPath, [
    "init",
    "--quiet",
    "--bare",
    `--object-format=${objectFormat}`,
    `--template=${emptyTemplate}`,
    isolatedRepository,
  ]);
  const archiveEnvironment = cleanGitEnvironment({
    GIT_ALTERNATE_OBJECT_DIRECTORIES: alternateObjectDirectoryValue(objectDirectory),
  });
  return {archiveEnvironment, isolatedRepository, isolationIdentity, isolationRoot};
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function assertDirectoryIdentity(directoryPath, expectedIdentity, label) {
  const current = await lstat(directoryPath);
  if (current.isSymbolicLink() || !current.isDirectory() || !sameIdentity(current, expectedIdentity)) {
    throw new Error(`${label} identity changed during release packaging`);
  }
  return current;
}

async function cleanupStagingDirectory(stagingPath, stagingIdentity) {
  const current = await pathMetadata(stagingPath);
  if (!current) return;
  if (current.isSymbolicLink() || !current.isDirectory() || !sameIdentity(current, stagingIdentity)) {
    throw new Error("refusing to clean up a staging path whose identity changed");
  }
  await rm(stagingPath, {recursive: true, force: false});
}

async function sha256ForOpenFile(fileHandle) {
  const metadata = await fileHandle.stat();
  if (!metadata.isFile()) throw new Error("release archive is not a regular file");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  while (position < metadata.size) {
    const length = Math.min(buffer.length, metadata.size - position);
    const {bytesRead} = await fileHandle.read(buffer, 0, length, position);
    if (bytesRead === 0) throw new Error("release archive ended before its reported size");
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
}

export async function packageRelease({repositoryRoot, approvedRoot, ref, outputDirectory} = {}) {
  const resolvedRepositoryRoot = await assertRegularDirectory(repositoryRoot, "repository root");
  const resolvedApprovedRoot = await assertRegularDirectory(approvedRoot, "approved root");
  const approvedRootIdentity = await lstat(resolvedApprovedRoot);
  if (typeof ref !== "string" || !RELEASE_REF.test(ref)) {
    throw new TypeError("release ref must match v<major>.<minor>.<patch>");
  }

  const resolvedOutput = assertApprovedDescendant(
    resolvedApprovedRoot,
    requirePath(outputDirectory, "output directory"),
  );
  if (path.dirname(resolvedOutput) !== resolvedApprovedRoot) {
    throw new TypeError("output directory must be a direct child of the approved root");
  }
  await assertNoSymlinkWithin(resolvedApprovedRoot, resolvedOutput);
  if (await pathMetadata(resolvedOutput)) {
    throw new Error("output directory already exists");
  }

  const {commit} = await resolveAnnotatedReleaseTag(resolvedRepositoryRoot, ref);
  await assertSafeReleaseTree(resolvedRepositoryRoot, commit);
  await assertDirectoryIdentity(resolvedApprovedRoot, approvedRootIdentity, "approved root");

  const archiveName = `create-visual-article-site-${ref}.zip`;
  const stagingPath = await mkdtemp(path.join(resolvedApprovedRoot, ".package-release-"));
  await chmod(stagingPath, 0o700);
  const stagingIdentity = await lstat(stagingPath);
  const stagingArchivePath = path.join(stagingPath, archiveName);
  const stagingChecksumPath = `${stagingArchivePath}.sha256`;
  const archivePath = path.join(resolvedOutput, archiveName);
  const checksumPath = `${archivePath}.sha256`;
  let published = false;
  try {
    await assertDirectoryIdentity(stagingPath, stagingIdentity, "staging directory");
    const {
      archiveEnvironment,
      isolatedRepository,
      isolationIdentity,
      isolationRoot,
    } = await createIsolatedArchiveRepository(resolvedRepositoryRoot, stagingPath);
    const archiveHandle = await open(
      stagingArchivePath,
      fsConstants.O_RDWR |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW,
      0o600,
    );
    let sha256;
    try {
      await runGitToFile(isolatedRepository, [
        "-c",
        `core.attributesFile=${os.devNull}`,
        "archive",
        "--format=zip",
        "--prefix=create-visual-article-site/",
        commit,
        ...RELEASE_PATHS,
      ], archiveHandle.fd, archiveEnvironment);
      await archiveHandle.sync();
      sha256 = await sha256ForOpenFile(archiveHandle);
    } finally {
      await archiveHandle.close();
    }
    await assertDirectoryIdentity(stagingPath, stagingIdentity, "staging directory");
    await assertDirectoryIdentity(isolationRoot, isolationIdentity, "Git isolation directory");
    await rm(isolationRoot, {recursive: true, force: false});
    const checksumHandle = await open(
      stagingChecksumPath,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW,
      0o644,
    );
    try {
      await checksumHandle.writeFile(`${sha256}  ${archiveName}\n`, "utf8");
      await checksumHandle.sync();
    } finally {
      await checksumHandle.close();
    }
    await assertDirectoryIdentity(resolvedApprovedRoot, approvedRootIdentity, "approved root");
    await assertDirectoryIdentity(stagingPath, stagingIdentity, "staging directory");
    if (await pathMetadata(resolvedOutput)) throw new Error("output directory already exists");
    try {
      await rename(stagingPath, resolvedOutput);
    } catch (error) {
      if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY") {
        throw new Error("output directory already exists");
      }
      throw error;
    }
    published = true;
    return {archivePath, checksumPath, sha256, commit};
  } catch (error) {
    if (!published) {
      try {
        await cleanupStagingDirectory(stagingPath, stagingIdentity);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `release packaging failed and staging cleanup was refused: ${error.message}`,
        );
      }
    }
    throw error;
  }
}

function parseArgs(argv) {
  if (argv.length === 0 || argv.length % 2 !== 0) throw new TypeError(CLI_USAGE);
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!CLI_FLAGS.has(flag)) throw new TypeError(`unknown flag: ${flag ?? "missing"}\n${CLI_USAGE}`);
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      throw new TypeError(`missing value for ${flag}\n${CLI_USAGE}`);
    }
    if (Object.hasOwn(options, flag)) throw new TypeError(`duplicate flag: ${flag}\n${CLI_USAGE}`);
    options[flag] = value;
  }
  for (const flag of CLI_FLAGS) {
    if (!Object.hasOwn(options, flag)) throw new TypeError(`missing required flag: ${flag}\n${CLI_USAGE}`);
  }
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  const result = await packageRelease({
    repositoryRoot: options["--repository"],
    approvedRoot: options["--approved-root"],
    ref: options["--ref"],
    outputDirectory: options["--output"],
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
