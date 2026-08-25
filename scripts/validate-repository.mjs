import {lstat, readFile, readdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {isCollection, isPair, parseDocument} from "yaml";

const EXPECTED_NAME = "create-visual-article-site";
const EXPECTED_VERSION = "2.2.0";
const PAGES_URL = "https://shadow71833-sketch.github.io/create-visual-article-site/";
const OBSOLETE_ARCHIVE = "create-visual-article-site-v2.0.0.zip";
const MAX_ALIAS_COUNT = 100;
const REQUIRED_FILES = [
  ".github/workflows/ci.yml",
  ".github/workflows/pages.yml",
  "LICENSE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "README.md",
  "SKILL.md",
  "docs/demo/verification-report.json",
  "docs/demo/completeness-report.json",
];
const REPORT_FILES = [
  "docs/demo/verification-report.json",
  "docs/demo/completeness-report.json",
];

async function readRequired(root, relative, errors) {
  const filePath = path.join(root, relative);
  try {
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new TypeError("must be a regular non-symlink file");
    }
    return await readFile(filePath, "utf8");
  } catch (error) {
    errors.push(`${relative}: ${error.message}`);
    return null;
  }
}

function parseJson(text, relative, errors) {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    errors.push(`${relative}: ${error.message}`);
    return null;
  }
}

function hasExplicitMappingKey(node) {
  if (isPair(node)) {
    return (
      node.srcToken?.explicitKey === true ||
      hasExplicitMappingKey(node.key) ||
      hasExplicitMappingKey(node.value)
    );
  }
  if (isCollection(node)) return node.items.some((item) => hasExplicitMappingKey(item));
  return false;
}

function validateActionReference(relative, action, errors) {
  if (typeof action !== "string" || action.length === 0) {
    errors.push(`${relative}: uses field must contain a scalar action reference`);
    return;
  }
  const separator = action.lastIndexOf("@");
  const ref = separator === -1 ? "" : action.slice(separator + 1);
  if (!/^[a-f0-9]{40}$/i.test(ref)) {
    errors.push(`${relative}: action ${action} must use a full 40-character commit SHA`);
  }
}

function validateUsesValues(relative, value, errors, visited = new WeakSet()) {
  if (value === null || typeof value !== "object" || visited.has(value)) return;
  visited.add(value);

  if (value instanceof Map) {
    for (const [key, child] of value) {
      if (key === "uses") validateActionReference(relative, child, errors);
      validateUsesValues(relative, child, errors, visited);
    }
    return;
  }
  if (Array.isArray(value) || value instanceof Set) {
    for (const child of value) validateUsesValues(relative, child, errors, visited);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "uses") validateActionReference(relative, child, errors);
    validateUsesValues(relative, child, errors, visited);
  }
}

function validateActionPins(relative, text, errors) {
  if (text === null) return;
  try {
    const document = parseDocument(text, {
      keepSourceTokens: true,
      strict: true,
      uniqueKeys: true,
    });
    const diagnostics = [...document.errors, ...document.warnings];
    if (diagnostics.length > 0) {
      for (const diagnostic of diagnostics) {
        errors.push(`${relative}: YAML validation failed: ${diagnostic.message}`);
      }
      return;
    }
    if (hasExplicitMappingKey(document.contents)) {
      errors.push(`${relative}: explicit mapping keys are not supported`);
    }
    const workflow = document.toJS({mapAsMap: true, maxAliasCount: MAX_ALIAS_COUNT});
    validateUsesValues(relative, workflow, errors);
  } catch (error) {
    errors.push(`${relative}: YAML validation failed: ${error.message}`);
  }
}

async function readWorkflowFiles(root, texts, errors) {
  const directoryRelative = ".github/workflows";
  const directoryPath = path.join(root, directoryRelative);
  try {
    const metadata = await lstat(directoryPath);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new TypeError("must be a regular non-symlink directory");
    }
    const names = (await readdir(directoryPath))
      .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
      .sort();
    const workflowFiles = [];
    for (const name of names) {
      const relative = path.posix.join(directoryRelative, name);
      if (!texts.has(relative)) {
        texts.set(relative, await readRequired(root, relative, errors));
      }
      workflowFiles.push(relative);
    }
    return workflowFiles;
  } catch (error) {
    errors.push(`${directoryRelative}: ${error.message}`);
    return [];
  }
}

async function validateObsoleteArchive(root, errors) {
  try {
    await lstat(path.join(root, OBSOLETE_ARCHIVE));
    errors.push(`${OBSOLETE_ARCHIVE}: obsolete root release archive must be removed`);
  } catch (error) {
    if (error.code !== "ENOENT") {
      errors.push(`${OBSOLETE_ARCHIVE}: ${error.message}`);
    }
  }
}

export async function validateRepository(rootPath) {
  const root = path.resolve(rootPath);
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new TypeError("repository root must be a regular directory");
  }

  const errors = [];
  const texts = new Map();
  for (const relative of REQUIRED_FILES) {
    texts.set(relative, await readRequired(root, relative, errors));
  }

  const packageText = await readRequired(root, "package.json", errors);
  const packageMetadata = parseJson(packageText, "package.json", errors);
  if (packageMetadata?.name !== EXPECTED_NAME) {
    errors.push("package.json: unexpected package name");
  }
  if (packageMetadata?.version !== EXPECTED_VERSION) {
    errors.push(`package.json: expected version ${EXPECTED_VERSION}`);
  }

  if (!texts.get("LICENSE")?.includes("Copyright (c) 2026 shadow71833-sketch")) {
    errors.push("LICENSE: expected MIT copyright holder");
  }
  for (const relative of ["README.md", "CHANGELOG.md"]) {
    if (!texts.get(relative)?.includes(EXPECTED_VERSION)) {
      errors.push(`${relative}: expected version ${EXPECTED_VERSION}`);
    }
  }
  if (!texts.get("README.md")?.includes(PAGES_URL)) {
    errors.push(`README.md: expected public Pages URL ${PAGES_URL}`);
  }

  const workflowFiles = await readWorkflowFiles(root, texts, errors);
  for (const relative of workflowFiles) {
    validateActionPins(relative, texts.get(relative), errors);
  }

  await validateObsoleteArchive(root, errors);

  for (const relative of REPORT_FILES) {
    const report = parseJson(texts.get(relative), relative, errors);
    if (report !== null && report?.ok !== true) {
      errors.push(`${relative}: expected ok true`);
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
