import {lstat, readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const EXPECTED_NAME = "create-visual-article-site";
const EXPECTED_VERSION = "2.2.0";
const REQUIRED_FILES = [
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
