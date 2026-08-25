import { Buffer } from "node:buffer";

import {
  escapeAttribute,
  escapeHtml,
  sanitizePublicUrl,
} from "./security.mjs";
import { resolveSourceType } from "./content-model.mjs";

function renderBlock(block) {
  if (block.type === "paragraph") return `<p>${escapeHtml(block.text)}</p>`;
  if (block.type === "quote") return `<blockquote class="article-quote">${escapeHtml(block.text)}</blockquote>`;
  if (block.type === "code") return `<pre class="article-code"><code>${escapeHtml(block.text)}</code></pre>`;
  if (block.type === "list") {
    const tag = block.ordered ? "ol" : "ul";
    return `<${tag}>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${tag}>`;
  }
  if (block.type === "callout") {
    return `<aside class="article-callout" data-tone="${escapeAttribute(block.tone ?? "note")}"><h3>${escapeHtml(block.title)}</h3><p>${escapeHtml(block.text)}</p></aside>`;
  }
  if (block.type === "table") {
    const caption = block.caption ? `<caption>${escapeHtml(block.caption)}</caption>` : "";
    const head = `<thead><tr>${block.headers.map((cell) => `<th scope="col">${escapeHtml(cell)}</th>`).join("")}</tr></thead>`;
    const body = `<tbody>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
    return `<div class="table-scroll"><table>${caption}${head}${body}</table></div>`;
  }
  if (block.type === "image") {
    const caption = block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : "";
    return `<figure class="article-figure"><img src="${escapeAttribute(block.src)}" alt="${escapeAttribute(block.alt)}" loading="lazy" decoding="async">${caption}</figure>`;
  }
  if (block.type === "media-link") {
    return `<a class="article-media-link" href="${escapeAttribute(sanitizePublicUrl(block.url))}" target="_blank" rel="noreferrer noopener"><span class="media-link-kicker">官方媒体</span><strong>${escapeHtml(block.title)}</strong><span>${escapeHtml(block.text)}</span></a>`;
  }
  throw new TypeError(`Unsupported block type: ${block.type}`);
}

export function renderArticle(articlePackage) {
  const {article} = articlePackage;
  const sourceType = resolveSourceType(article.source);
  const sourceLink = sourceType === "public-url"
    ? `<a href="${escapeAttribute(sanitizePublicUrl(article.source.url))}" target="_blank" rel="noreferrer noopener">阅读来源</a>`
    : `<span class="source-kind">用户提供原文</span>`;
  const publishedAt = article.source.publishedAt ? `<span>${escapeHtml(article.source.publishedAt)}</span>` : "";
  const sections = article.sections.map((section, index) => `<section class="article-section" id="${escapeAttribute(section.id)}"><span class="section-kicker">Section ${String(index + 1).padStart(2, "0")}</span><h2>${escapeHtml(section.title)}</h2>${section.blocks.map(renderBlock).join("")}</section>`).join("");
  const keyPoints = article.keyPoints.length > 0 ? `<ul class="key-points">${article.keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>` : "";
  return `<div class="article-shell"><article class="article-main">
    <header class="article-hero"><span class="eyebrow">${article.source.verified ? "Verified source" : "Source not independently verified"}</span><h1>${escapeHtml(article.title)}</h1><p class="article-subtitle">${escapeHtml(article.subtitle)}</p><div class="article-meta"><span>${escapeHtml(article.source.name)}</span>${publishedAt}<span>${article.readingMinutes} 分钟阅读</span>${sourceLink}</div></header>
    <section class="article-summary"><span class="section-kicker">一分钟速览</span><p>${escapeHtml(article.summary)}</p>${keyPoints}</section>
    <div class="article-body">${sections}</div>
  </article></div>`;
}

export function renderOnePage(articlePackage) {
  const {onePage} = articlePackage;
  const metrics = onePage.metrics.map((metric) => `<article class="metric-card"><span class="metric-value">${escapeHtml(metric.value)}</span><span class="metric-label">${escapeHtml(metric.label)}</span><span class="metric-note">${escapeHtml(metric.note)}</span></article>`).join("");
  const modules = onePage.modules.map((module) => `<section class="one-page-module" data-module="${escapeAttribute(module.type)}"><h2>${escapeHtml(module.title)}</h2><div class="module-items">${module.items.map((item) => `<article class="module-item"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p></article>`).join("")}</div></section>`).join("");
  return `<div class="one-page-shell"><header class="one-page-hero"><div><span class="eyebrow">${escapeHtml(onePage.eyebrow)}</span><h1>${escapeHtml(onePage.headline)}</h1><p class="one-page-deck">${escapeHtml(onePage.deck)}</p></div><div class="metric-grid">${metrics}</div></header><div class="one-page-modules">${modules}</div></div>`;
}

function renderComicSubtitles(subtitles = []) {
  if (subtitles.length === 0) return "";
  return `<div class="comic-subtitles" aria-label="漫画字幕">${subtitles.map((subtitle) => `<div class="comic-subtitle" data-kind="${escapeAttribute(subtitle.kind)}">${escapeHtml(subtitle.text)}</div>`).join("")}</div>`;
}

function renderComicPanelGrid(page, panelsById) {
  const {columns, rows} = page.panelGrid;
  const frames = page.subtitles.map((subtitle, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const panel = panelsById.get(subtitle.panelId);
    const alt = panel?.scene ? `${page.alt}：${panel.scene}` : `${page.alt}：漫画分格`;
    return `<article class="comic-panel-frame comic-panel-col-${column} comic-panel-row-${row}"><div class="comic-panel-visual"><img class="comic-panel-sheet" src="${escapeAttribute(page.image)}" alt="${escapeAttribute(alt)}" loading="lazy" decoding="async"></div><div class="comic-subtitle comic-panel-caption" data-kind="${escapeAttribute(subtitle.kind)}">${escapeHtml(subtitle.text)}</div></article>`;
  }).join("");
  return `<div class="comic-panel-grid comic-grid-columns-${columns} comic-grid-rows-${rows}" aria-label="逐格漫画">${frames}</div>`;
}

function renderEditorialDisplay(panel) {
  const display = panel.display;
  const kicker = display.kicker ? `<div class="comic-editorial-kicker">${escapeHtml(display.kicker)}</div>` : "";
  const detail = display.detail ? `<div class="comic-editorial-detail">${escapeHtml(display.detail)}</div>` : "";
  const mark = display.mark ? `<span class="comic-editorial-mark">${escapeHtml(display.mark)}</span>` : "";
  const items = display.items ?? [];
  if (display.kind === "list") {
    return `${kicker}<p class="comic-editorial-text">${escapeHtml(display.text)}</p><ul class="comic-editorial-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>${detail}${mark}`;
  }
  if (display.kind === "diagram") {
    return `${kicker}<p class="comic-editorial-text">${escapeHtml(display.text)}</p><ol class="comic-editorial-diagram">${items.map((item) => `<li><span>${escapeHtml(item)}</span></li>`).join("")}</ol>${detail}${mark}`;
  }
  if (display.kind === "stat") {
    return `${kicker}<strong class="comic-editorial-stat">${escapeHtml(display.text)}</strong>${detail}${mark}`;
  }
  if (display.kind === "sfx") {
    return `${kicker}<strong class="comic-editorial-sfx">${escapeHtml(display.text)}</strong>${detail}${mark}`;
  }
  if (["bubble", "thought", "shout"].includes(display.kind)) {
    return `${kicker}<p class="comic-editorial-bubble">${escapeHtml(display.text)}</p>${detail}${mark}`;
  }
  if (display.kind === "takeaway") {
    return `${kicker}<p class="comic-editorial-takeaway">${escapeHtml(display.text)}</p>${detail}${mark}`;
  }
  return `${kicker}<p class="comic-editorial-text">${escapeHtml(display.text)}</p>${detail}${mark}`;
}

function renderEditorialComicPage(page, panelsById) {
  const rows = page.rows.map((row) => `<div class="comic-editorial-row comic-editorial-row-${escapeAttribute(row.layout)}">${row.panelIds.map((panelId) => {
    const panel = panelsById.get(panelId);
    const kind = panel.display.kind;
    const tone = panel.display.tone ?? "light";
    return `<section class="comic-editorial-panel comic-${escapeAttribute(kind)} comic-tone-${escapeAttribute(tone)}">${renderEditorialDisplay(panel)}</section>`;
  }).join("")}</div>`).join("");
  const caption = page.caption ? `<footer class="comic-editorial-footer">${escapeHtml(page.caption)}</footer>` : "";
  return `<article class="comic-editorial-card"><span class="comic-editorial-number">${escapeHtml(page.number)}</span>${rows}${caption}</article>`;
}

export function renderComic(articlePackage) {
  const {comic} = articlePackage;
  const panelsById = new Map(comic.panels.map((panel) => [panel.id, panel]));
  let content;
  if (comic.pages.length > 0) {
    content = comic.pages.map((page) => {
      if (page.format === "editorial") return renderEditorialComicPage(page, panelsById);
      const deliveredComic = page.panelGrid
        ? renderComicPanelGrid(page, panelsById)
        : `<div class="comic-page-media"><img src="${escapeAttribute(page.image)}" alt="${escapeAttribute(page.alt)}" loading="lazy" decoding="async"></div>${renderComicSubtitles(page.subtitles)}`;
      return `<figure class="comic-page">${deliveredComic}<figcaption>${escapeHtml(page.caption)}</figcaption></figure>`;
    }).join("");
  } else {
    content = `<div class="storyboard-fallback" aria-label="漫画分镜脚本">${comic.panels.map((panel, index) => `<article class="story-panel"><span class="panel-number">${String(index + 1).padStart(2, "0")}</span><div><h2>${escapeHtml(panel.scene)}</h2>${panel.dialogue ? `<p class="dialogue">“${escapeHtml(panel.dialogue)}”</p>` : ""}<p>${escapeHtml(panel.narration)}</p></div></article>`).join("")}</div>`;
  }
  return `<div class="comic-shell"><header class="comic-header"><span class="eyebrow">Visual story · ${escapeHtml(articlePackage.theme.comicStyle)}</span><h1>${escapeHtml(comic.title)}</h1></header><div class="comic-pages">${content}</div></div>`;
}

export function renderThemeCss(articlePackage) {
  const {colors} = articlePackage.theme;
  return `:root{--paper:${colors.paper};--surface:${colors.surface};--ink:${colors.ink};--muted:${colors.muted};--accent:${colors.accent};--signal:${colors.signal};}\n`;
}

function replaceMarker(template, marker, value) {
  if (!template.includes(marker)) throw new TypeError(`Site template is missing marker: ${marker}`);
  return template.replace(marker, value);
}

export function renderSiteDocument(articlePackage, template) {
  const {article, theme, markdown} = articlePackage;
  const encodedMarkdown = Buffer.from(markdown, "utf8").toString("base64");
  const publishedAt = article.source.publishedAt ? `　${escapeHtml(article.source.publishedAt)}` : "";
  const sourceSummary = `<span class="verified-mark">${article.source.verified ? "✓ 已核验" : "△ 待核验"}</span>　来源 <strong>${escapeHtml(article.source.name)}</strong>${publishedAt} · ${article.readingMinutes} 分钟`;
  const sourceAttribution = resolveSourceType(article.source) === "public-url"
    ? `<a href="${escapeAttribute(sanitizePublicUrl(article.source.url))}" target="_blank" rel="noreferrer noopener">${escapeHtml(article.source.name)}</a>`
    : `<span>${escapeHtml(article.source.name)}</span>`;
  const footer = `<span>由可视化文章网站 skill 生成</span><span>来源：${sourceAttribution}</span>`;
  const replacements = [
    ["__ARTICLE_THEME__", escapeAttribute(theme.articleTheme)],
    ["__ONE_PAGE_LAYOUT__", escapeAttribute(theme.onePageLayout)],
    ["__META_DESCRIPTION__", escapeAttribute(article.summary.slice(0, 180))],
    ["__DOCUMENT_TITLE__", escapeHtml(article.title)],
    ["<!--SOURCE_SUMMARY-->", sourceSummary],
    ["<!--ARTICLE_CONTENT-->", renderArticle(articlePackage)],
    ["<!--ONE_PAGE_CONTENT-->", renderOnePage(articlePackage)],
    ["<!--COMIC_CONTENT-->", renderComic(articlePackage)],
    ["<!--FOOTER_CONTENT-->", footer],
    ["<!--MARKDOWN_JSON-->", JSON.stringify(encodedMarkdown)],
  ];
  return replacements.reduce((html, [marker, value]) => replaceMarker(html, marker, value), template);
}
