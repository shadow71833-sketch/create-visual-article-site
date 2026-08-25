import {lstat, readFile, readdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const EXPECTED_NAME = "create-visual-article-site";
const EXPECTED_VERSION = "2.2.0";
const PAGES_URL = "https://shadow71833-sketch.github.io/create-visual-article-site/";
const OBSOLETE_ARCHIVE = "create-visual-article-site-v2.0.0.zip";
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

const DOUBLE_QUOTED_ESCAPES = new Map([
  ["0", "\0"],
  ["a", "\x07"],
  ["b", "\b"],
  ["t", "\t"],
  ["n", "\n"],
  ["v", "\v"],
  ["f", "\f"],
  ["r", "\r"],
  ["e", "\x1b"],
  [" ", " "],
  ["\"", "\""],
  ["/", "/"],
  ["\\", "\\"],
  ["N", "\u0085"],
  ["_", "\u00a0"],
  ["L", "\u2028"],
  ["P", "\u2029"],
]);

function readDoubleQuotedEscape(line, start) {
  const escaped = line[start];
  if (DOUBLE_QUOTED_ESCAPES.has(escaped)) {
    return {value: DOUBLE_QUOTED_ESCAPES.get(escaped), end: start + 1};
  }
  const digitCount = new Map([
    ["x", 2],
    ["u", 4],
    ["U", 8],
  ]).get(escaped);
  if (digitCount === undefined) return {error: "invalid double-quoted escape"};

  const digits = line.slice(start + 1, start + 1 + digitCount);
  if (digits.length !== digitCount || !/^[a-f0-9]+$/i.test(digits)) {
    return {error: "invalid double-quoted escape"};
  }
  const codePoint = Number.parseInt(digits, 16);
  if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
    return {error: "invalid double-quoted escape"};
  }
  return {value: String.fromCodePoint(codePoint), end: start + 1 + digitCount};
}

function readQuotedScalar(line, start) {
  const quote = line[start];
  let value = "";
  for (let index = start + 1; index < line.length; index += 1) {
    const character = line[index];
    if (quote === "'" && character === "'" && line[index + 1] === "'") {
      value += "'";
      index += 1;
      continue;
    }
    if (quote === "\"" && character === "\\") {
      const escaped = readDoubleQuotedEscape(line, index + 1);
      if (escaped.error) return escaped;
      value += escaped.value;
      index = escaped.end - 1;
      continue;
    }
    if (character === quote) return {value, end: index + 1};
    value += character;
  }
  return {error: "unterminated quoted scalar"};
}

function yamlCommentIndex(line) {
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\"" || character === "'") {
      const scalar = readQuotedScalar(line, index);
      if (scalar.error) return line.length;
      index = scalar.end - 1;
    } else if (character === "#" && (index === 0 || /\s/.test(line[index - 1]))) {
      return index;
    }
  }
  return line.length;
}

function isMappingKeyBoundary(line, index) {
  let previous = index - 1;
  while (previous >= 0 && /[ \t]/.test(line[previous])) previous -= 1;
  if (previous < 0 || line[previous] === "{" || line[previous] === ",") return true;
  return line[previous] === "-" && (previous === 0 || /\s/.test(line[previous - 1]));
}

function skipInlineWhitespace(line, start, end) {
  let cursor = start;
  while (cursor < end && /[ \t]/.test(line[cursor])) cursor += 1;
  return cursor;
}

function readUsesField(line, start, commentAt) {
  let cursor = skipInlineWhitespace(line, start, commentAt);
  if (cursor >= commentAt || /[,}\]]/.test(line[cursor])) {
    return {
      field: {error: "uses field must contain a scalar action reference"},
      end: cursor,
    };
  }

  if (line[cursor] === "\"" || line[cursor] === "'") {
    const scalar = readQuotedScalar(line, cursor);
    if (scalar.error) {
      return {field: {error: `uses field contains an ${scalar.error}`}, end: commentAt};
    }
    cursor = skipInlineWhitespace(line, scalar.end, commentAt);
    if (cursor < commentAt && !/[,}\]]/.test(line[cursor])) {
      return {field: {error: "uses field contains an invalid quoted scalar"}, end: cursor};
    }
    if (scalar.value.length === 0) {
      return {
        field: {error: "uses field must contain a scalar action reference"},
        end: cursor,
      };
    }
    return {field: {value: scalar.value}, end: cursor};
  }

  const valueStart = cursor;
  while (cursor < commentAt && !/[,}\]]/.test(line[cursor])) cursor += 1;
  const value = line.slice(valueStart, cursor).trim();
  return {
    field:
      value.length === 0
        ? {error: "uses field must contain a scalar action reference"}
        : {value},
    end: cursor,
  };
}

function extractUsesFields(line) {
  const fields = [];
  const commentAt = yamlCommentIndex(line);
  for (let index = 0; index < commentAt; index += 1) {
    const character = line[index];
    let key = null;
    let cursor = index;
    if (character === "\"" || character === "'") {
      const scalar = readQuotedScalar(line, cursor);
      if (scalar.error) break;
      if (isMappingKeyBoundary(line, index)) key = scalar.value;
      cursor = scalar.end;
    } else if (line.startsWith("uses", index) && isMappingKeyBoundary(line, index)) {
      cursor = index + "uses".length;
      if (!/[A-Za-z0-9_-]/.test(line[cursor] ?? "")) key = "uses";
    } else {
      continue;
    }

    cursor = skipInlineWhitespace(line, cursor, commentAt);
    if (line[cursor] !== ":" || key !== "uses") {
      index = cursor - 1;
      continue;
    }
    const result = readUsesField(line, cursor + 1, commentAt);
    fields.push(result.field);
    index = result.end;
  }
  return fields;
}

function validateActionPins(relative, text, errors) {
  if (text === null) return;
  let blockScalarIndent = null;
  const lines = text.split(/\r?\n/);
  for (const [lineIndex, line] of lines.entries()) {
    const indentation = line.match(/^[ \t]*/)[0].length;
    if (blockScalarIndent !== null) {
      if (line.trim().length === 0 || indentation > blockScalarIndent) continue;
      blockScalarIndent = null;
    }

    for (const field of extractUsesFields(line)) {
      if (field.error) {
        errors.push(`${relative}:${lineIndex + 1}: ${field.error}`);
        continue;
      }
      const action = field.value;
      const separator = action.lastIndexOf("@");
      const ref = separator === -1 ? "" : action.slice(separator + 1);
      if (!/^[a-f0-9]{40}$/i.test(ref)) {
        errors.push(`${relative}: action ${action} must use a full 40-character commit SHA`);
      }
    }

    const content = line.slice(0, yamlCommentIndex(line)).trimEnd();
    if (/:\s*[>|](?:[1-9]?[+-]?|[+-]?[1-9]?)?\s*$/.test(content)) {
      blockScalarIndent = indentation;
    }
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
