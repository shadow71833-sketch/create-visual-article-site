import { sanitizePublicUrl } from "./security.mjs";
import { resolveSourceType } from "./content-model.mjs";

function escapeMarkdownText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([\\`*_{}\[\]()#+.!|~-])/gu, "\\$1");
}

function escapeTableCell(value) {
  return escapeMarkdownText(value).replace(/\r?\n/gu, "<br>");
}

function quoteLines(value) {
  return String(value ?? "").split(/\r?\n/gu).map((line) => `> ${escapeMarkdownText(line)}`).join("\n");
}

function codeFence(value) {
  const text = String(value ?? "");
  const longest = Math.max(0, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

function renderBlock(block) {
  if (block.type === "paragraph") return escapeMarkdownText(block.text);
  if (block.type === "quote") return quoteLines(block.text);
  if (block.type === "code") return codeFence(block.text);
  if (block.type === "list") {
    return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : "-"} ${escapeMarkdownText(item)}`).join("\n");
  }
  if (block.type === "callout") {
    return `> **${escapeMarkdownText(block.title)}**\n>\n${quoteLines(block.text)}`;
  }
  if (block.type === "table") {
    const rows = [
      `| ${block.headers.map(escapeTableCell).join(" | ")} |`,
      `| ${block.headers.map(() => "---").join(" | ")} |`,
      ...block.rows.map((row) => `| ${row.map(escapeTableCell).join(" | ")} |`),
    ];
    if (block.caption) rows.unshift(`*${escapeMarkdownText(block.caption)}*`, "");
    return rows.join("\n");
  }
  if (block.type === "image") {
    const image = `![${escapeMarkdownText(block.alt)}](${block.src})`;
    return block.caption ? `${image}\n\n*${escapeMarkdownText(block.caption)}*` : image;
  }
  if (block.type === "media-link") {
    return `[${escapeMarkdownText(block.title)}](${sanitizePublicUrl(block.url)})\n\n${escapeMarkdownText(block.text)}`;
  }
  throw new TypeError(`Unsupported block type: ${block.type}`);
}

function renderSection(section) {
  return [`## ${escapeMarkdownText(section.title)}`, ...section.blocks.map(renderBlock)].join("\n\n");
}

export function renderArticleMarkdown(articlePackage) {
  const {article} = articlePackage;
  const sourceLine = resolveSourceType(article.source) === "public-url"
    ? `来源：[${escapeMarkdownText(article.source.name)}](${sanitizePublicUrl(article.source.url)})`
    : `来源：${escapeMarkdownText(article.source.name)}`;
  const parts = [
    `# ${escapeMarkdownText(article.title)}`,
    article.subtitle ? quoteLines(article.subtitle) : "",
    "## 一分钟速览",
    escapeMarkdownText(article.summary),
    article.keyPoints.length > 0 ? article.keyPoints.map((point) => `- ${escapeMarkdownText(point)}`).join("\n") : "",
    ...article.sections.map(renderSection),
    sourceLine,
  ];
  return `${parts.filter((part) => part.length > 0).join("\n\n")}\n`;
}
