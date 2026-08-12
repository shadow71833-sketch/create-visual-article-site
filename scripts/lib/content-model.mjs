import path from "node:path";

import {ALLOWED_IMAGE_EXTENSIONS} from "./image-inspection.mjs";
import {auditPresentationCoverage} from "./presentation-coverage.mjs";
import {assertSafeRelativePath, sanitizePublicUrl, sensitiveValueFindings} from "./security.mjs";

export const CONTENT_VERSION = 2;

export const BLOCK_TYPES = Object.freeze([
  "paragraph",
  "list",
  "table",
  "quote",
  "image",
  "callout",
  "code",
  "media-link",
]);

const FACT_STATUSES = new Set(["verified", "source-claimed", "unverified"]);
const SOURCE_TYPES = new Set(["public-url", "pasted-text"]);
const COMIC_SUBTITLE_KINDS = new Set(["narration", "dialogue"]);
const COMIC_PAGE_FORMATS = new Set(["image", "editorial"]);
const EDITORIAL_ROW_LAYOUTS = new Map([
  ["single", 1],
  ["split", 2],
  ["wide-left", 2],
  ["wide-right", 2],
  ["triptych", 3],
  ["focus-left", 3],
]);
const EDITORIAL_DISPLAY_KINDS = new Set([
  "caption",
  "bubble",
  "thought",
  "shout",
  "sfx",
  "stat",
  "list",
  "diagram",
  "takeaway",
  "prose",
]);
const EDITORIAL_TONES = new Set(["light", "dark", "speed", "focus", "halftone"]);
const MODULE_TYPES = new Set([
  "cards",
  "timeline",
  "comparison",
  "process",
  "risks",
  "sources",
  "quote",
]);
const HEX_COLOR = /^#[0-9A-F]{6}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AI_GENERATION_METHODS = new Set(["native-imagegen", "legacy-unverified"]);
const EXPANSION_MODES = new Set(["standard", "complete"]);

export function resolveSourceType(value = {}) {
  return value?.sourceType ?? "public-url";
}

function validateSourceType(value, pathLabel, errors) {
  const sourceType = resolveSourceType(value);
  if (!SOURCE_TYPES.has(sourceType)) issue(errors, pathLabel, "must be public-url or pasted-text");
  return sourceType;
}

function issue(errors, path, message) {
  errors.push({path, message});
}

function validateString(value, path, errors, {allowEmpty = false, max = 20_000} = {}) {
  if (typeof value !== "string") {
    issue(errors, path, "must be a string");
    return;
  }
  if (!allowEmpty && value.trim().length === 0) issue(errors, path, "must not be empty");
  if (value.length > max) issue(errors, path, `must not exceed ${max} characters`);
}

function validateUrl(value, path, errors) {
  try {
    sanitizePublicUrl(value);
  } catch (error) {
    issue(errors, path, error.message);
  }
}

function validateTimestamp(value, path, errors) {
  validateString(value, path, errors, {max: 80});
  if (typeof value === "string" && Number.isNaN(Date.parse(value))) issue(errors, path, "must be an ISO-8601 timestamp");
}

function validateFactIds(value, path, errors, knownFactIds, {allowEmpty = true} = {}) {
  if (!Array.isArray(value)) {
    issue(errors, path, "must be an array");
    return;
  }
  if (!allowEmpty && value.length === 0) issue(errors, path, "must be a non-empty array");
  const seen = new Set();
  value.forEach((factId, index) => {
    validateString(factId, `${path}[${index}]`, errors, {max: 120});
    if (seen.has(factId)) issue(errors, `${path}[${index}]`, "must be unique within the array");
    seen.add(factId);
    if (typeof factId === "string" && !knownFactIds.has(factId)) {
      issue(errors, `${path}[${index}]`, "references an unknown fact");
    }
  });
}

function validateImagePath(value, pathLabel, errors) {
  validateString(value, pathLabel, errors);
  try {
    if (typeof value === "string") {
      const safe = assertSafeRelativePath(value);
      if (!safe.startsWith("assets/")) issue(errors, pathLabel, "must be stored under assets/");
      if (!ALLOWED_IMAGE_EXTENSIONS.has(path.posix.extname(safe).toLowerCase())) issue(errors, pathLabel, "must use PNG, JPEG, or WebP");
    }
  } catch (error) {
    issue(errors, pathLabel, error.message);
  }
}

function validateEditorialDisplay(display, pathLabel, errors) {
  if (!display || typeof display !== "object" || Array.isArray(display)) {
    issue(errors, pathLabel, "must be an object");
    return;
  }
  const allowedFields = new Set(["kind", "tone", "kicker", "text", "detail", "items", "mark"]);
  for (const field of Object.keys(display)) {
    if (!allowedFields.has(field)) issue(errors, `${pathLabel}.${field}`, "is not supported");
  }
  if (!EDITORIAL_DISPLAY_KINDS.has(display.kind)) {
    issue(errors, `${pathLabel}.kind`, `must be one of: ${[...EDITORIAL_DISPLAY_KINDS].join(", ")}`);
  }
  if (display.tone !== undefined && !EDITORIAL_TONES.has(display.tone)) {
    issue(errors, `${pathLabel}.tone`, `must be one of: ${[...EDITORIAL_TONES].join(", ")}`);
  }
  validateString(display.text, `${pathLabel}.text`, errors, {max: 80});
  if (display.kicker !== undefined) validateString(display.kicker, `${pathLabel}.kicker`, errors, {max: 80});
  if (display.detail !== undefined) validateString(display.detail, `${pathLabel}.detail`, errors, {max: 180});
  if (display.mark !== undefined) validateString(display.mark, `${pathLabel}.mark`, errors, {max: 12});
  const requiresItems = display.kind === "list" || display.kind === "diagram";
  if (display.items !== undefined || requiresItems) {
    if (!Array.isArray(display.items) || display.items.length === 0) {
      issue(errors, `${pathLabel}.items`, "must be a non-empty array");
    } else {
      display.items.forEach((item, index) => validateString(item, `${pathLabel}.items[${index}]`, errors, {max: 80}));
    }
  }
}

function validateBlock(block, pathLabel, errors, knownFactIds, {allowFactIds = true} = {}) {
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    issue(errors, pathLabel, "must be an object");
    return;
  }
  if (!BLOCK_TYPES.includes(block.type)) {
    issue(errors, `${pathLabel}.type`, `must be one of: ${BLOCK_TYPES.join(", ")}`);
    return;
  }

  if (["paragraph", "quote", "code"].includes(block.type)) {
    validateString(block.text, `${pathLabel}.text`, errors);
  }
  if (block.type === "list") {
    if (!Array.isArray(block.items) || block.items.length === 0) {
      issue(errors, `${pathLabel}.items`, "must be a non-empty array");
    } else {
      block.items.forEach((item, index) => validateString(item, `${pathLabel}.items[${index}]`, errors));
    }
  }
  if (block.type === "table") {
    if (!Array.isArray(block.headers) || block.headers.length === 0) issue(errors, `${pathLabel}.headers`, "must be a non-empty array");
    if (!Array.isArray(block.rows)) issue(errors, `${pathLabel}.rows`, "must be an array");
    const width = Array.isArray(block.headers) ? block.headers.length : 0;
    block.headers?.forEach((cell, index) => validateString(cell, `${pathLabel}.headers[${index}]`, errors));
    block.rows?.forEach((row, rowIndex) => {
      if (!Array.isArray(row) || row.length !== width) {
        issue(errors, `${pathLabel}.rows[${rowIndex}]`, `must contain exactly ${width} cells`);
        return;
      }
      row.forEach((cell, columnIndex) => validateString(cell, `${pathLabel}.rows[${rowIndex}][${columnIndex}]`, errors, {allowEmpty: true}));
    });
  }
  if (block.type === "image") {
    validateImagePath(block.src, `${pathLabel}.src`, errors);
    validateString(block.alt, `${pathLabel}.alt`, errors);
    if (block.caption !== undefined) validateString(block.caption, `${pathLabel}.caption`, errors, {allowEmpty: true});
  }
  if (block.type === "callout") {
    validateString(block.title, `${pathLabel}.title`, errors);
    validateString(block.text, `${pathLabel}.text`, errors);
  }
  if (block.type === "media-link") {
    validateString(block.title, `${pathLabel}.title`, errors, {max: 300});
    validateString(block.text, `${pathLabel}.text`, errors, {max: 2_000});
    validateUrl(block.url, `${pathLabel}.url`, errors);
  }
  if (block.factIds !== undefined && !allowFactIds) issue(errors, `${pathLabel}.factIds`, "must not appear in a source snapshot");
  if (block.factIds !== undefined && allowFactIds) validateFactIds(block.factIds, `${pathLabel}.factIds`, errors, knownFactIds);
}

function referencedImagePaths(value) {
  const articleImages = value.article?.sections?.flatMap((section) => section.blocks?.filter((block) => block?.type === "image").map((block) => block.src) ?? []) ?? [];
  const comicImages = value.comic?.pages?.map((page) => page?.image).filter(Boolean) ?? [];
  return {articleImages, comicImages, all: [...new Set([...articleImages, ...comicImages])]};
}

export function validateSourceSnapshot(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [{path: "$", message: "must be an object"}];
  if (value.version !== CONTENT_VERSION) issue(errors, "version", `must equal ${CONTENT_VERSION}`);
  const sourceType = validateSourceType(value, "sourceType", errors);
  if (sourceType === "public-url") {
    validateUrl(value.canonicalUrl, "canonicalUrl", errors);
  } else {
    if (value.canonicalUrl !== undefined) issue(errors, "canonicalUrl", "must be omitted for pasted-text sources");
    validateString(value.sourceName, "sourceName", errors, {max: 300});
  }
  validateTimestamp(value.capturedAt, "capturedAt", errors);
  if (!value.preamble || typeof value.preamble !== "object" || Array.isArray(value.preamble)) {
    issue(errors, "preamble", "must be an object");
  } else {
    validateString(value.preamble.title, "preamble.title", errors, {max: 300});
    if (value.preamble.subtitle !== undefined) validateString(value.preamble.subtitle, "preamble.subtitle", errors, {allowEmpty: true, max: 500});
    if (value.preamble.summary !== undefined) validateString(value.preamble.summary, "preamble.summary", errors, {allowEmpty: true, max: 2_000});
    if (value.preamble.keyPoints !== undefined) {
      if (!Array.isArray(value.preamble.keyPoints)) issue(errors, "preamble.keyPoints", "must be an array when provided");
      value.preamble.keyPoints?.forEach((point, index) => validateString(point, `preamble.keyPoints[${index}]`, errors));
    }
  }
  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    issue(errors, "sections", "must be a non-empty array");
  } else {
    value.sections.forEach((section, sectionIndex) => {
      const base = `sections[${sectionIndex}]`;
      validateString(section?.id, `${base}.id`, errors, {max: 120});
      validateString(section?.title, `${base}.title`, errors, {max: 300});
      if (!Array.isArray(section?.blocks)) issue(errors, `${base}.blocks`, "must be an array");
      section?.blocks?.forEach((block, blockIndex) => validateBlock(block, `${base}.blocks[${blockIndex}]`, errors, new Set(), {allowFactIds: false}));
    });
  }
  for (const finding of sensitiveValueFindings(value)) issue(errors, finding.path, `contains a sensitive value pattern: ${finding.pattern}`);
  return errors;
}

export function assertSourceSnapshot(value) {
  const errors = validateSourceSnapshot(value);
  if (errors.length > 0) throw new TypeError(`Invalid source snapshot:\n${errors.map(({path: itemPath, message}) => `${itemPath}: ${message}`).join("\n")}`);
  return value;
}

export function validateArticlePackage(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [{path: "$", message: "must be an object"}];
  }
  if (value.version !== CONTENT_VERSION) issue(errors, "version", `must equal ${CONTENT_VERSION}`);
  validateTimestamp(value.generatedAt, "generatedAt", errors);

  let expansionMode = "standard";
  if (value.delivery !== undefined) {
    if (!value.delivery || typeof value.delivery !== "object" || Array.isArray(value.delivery)) {
      issue(errors, "delivery", "must be an object when provided");
    } else {
      expansionMode = value.delivery.expansionMode;
      if (!EXPANSION_MODES.has(expansionMode)) issue(errors, "delivery.expansionMode", "must be standard or complete");
    }
  }

  const article = value.article;
  let articleSourceType = "public-url";
  if (!article || typeof article !== "object") {
    issue(errors, "article", "must be an object");
  } else {
    validateString(article.slug, "article.slug", errors, {max: 120});
    if (typeof article.slug === "string" && !SLUG.test(article.slug)) issue(errors, "article.slug", "must be a lowercase hyphenated slug");
    validateString(article.title, "article.title", errors, {max: 300});
    validateString(article.subtitle, "article.subtitle", errors, {allowEmpty: true, max: 500});
    validateString(article.summary, "article.summary", errors, {max: 2_000});
    if (!Number.isInteger(article.readingMinutes) || article.readingMinutes < 1 || article.readingMinutes > 10_000) {
      issue(errors, "article.readingMinutes", "must be an integer between 1 and 10000");
    }
    if (!article.source || typeof article.source !== "object") {
      issue(errors, "article.source", "must be an object");
    } else {
      articleSourceType = validateSourceType(article.source, "article.source.sourceType", errors);
      validateString(article.source.name, "article.source.name", errors, {max: 300});
      if (articleSourceType === "public-url") {
        validateUrl(article.source.url, "article.source.url", errors);
        validateString(article.source.publishedAt, "article.source.publishedAt", errors, {allowEmpty: true, max: 80});
      } else {
        if (article.source.url !== undefined) issue(errors, "article.source.url", "must be omitted for pasted-text sources");
        if (article.source.publishedAt !== undefined) validateString(article.source.publishedAt, "article.source.publishedAt", errors, {allowEmpty: true, max: 80});
      }
      if (typeof article.source.verified !== "boolean") issue(errors, "article.source.verified", "must be a boolean");
    }
    if (!Array.isArray(article.keyPoints)) issue(errors, "article.keyPoints", "must be an array");
    article.keyPoints?.forEach((point, index) => validateString(point, `article.keyPoints[${index}]`, errors));
  }

  const knownFactIds = new Set();
  if (!Array.isArray(value.facts)) {
    issue(errors, "facts", "must be an array");
  } else {
    value.facts.forEach((fact, index) => {
      const base = `facts[${index}]`;
      if (!fact || typeof fact !== "object") {
        issue(errors, base, "must be an object");
        return;
      }
      validateString(fact.id, `${base}.id`, errors, {max: 120});
      if (typeof fact.id === "string") {
        if (!ID.test(fact.id) || !fact.id.startsWith("fact-")) issue(errors, `${base}.id`, "must be a lowercase hyphenated fact ID");
        if (knownFactIds.has(fact.id)) issue(errors, `${base}.id`, "must be unique");
        knownFactIds.add(fact.id);
      }
      validateString(fact.claim, `${base}.claim`, errors);
      if (articleSourceType === "public-url") {
        validateUrl(fact.sourceUrl, `${base}.sourceUrl`, errors);
        if (fact.sourceRef !== undefined) issue(errors, `${base}.sourceRef`, "must be omitted for public-url sources");
      } else {
        if (fact.sourceUrl !== undefined) issue(errors, `${base}.sourceUrl`, "must be omitted for pasted-text sources");
        if (fact.sourceRef !== "source-snapshot") issue(errors, `${base}.sourceRef`, "must equal source-snapshot for pasted-text sources");
      }
      if (!FACT_STATUSES.has(fact.status)) issue(errors, `${base}.status`, "must be verified, source-claimed, or unverified");
    });
  }

  if (article && typeof article === "object") {
    if (!Array.isArray(article.sections) || article.sections.length === 0) {
      issue(errors, "article.sections", "must be a non-empty array");
    } else {
      const sectionIds = new Set();
      article.sections.forEach((section, index) => {
        const base = `article.sections[${index}]`;
        if (!section || typeof section !== "object") {
          issue(errors, base, "must be an object");
          return;
        }
        validateString(section.id, `${base}.id`, errors, {max: 120});
        if (typeof section.id === "string") {
          if (sectionIds.has(section.id)) issue(errors, `${base}.id`, "must be unique");
          sectionIds.add(section.id);
        }
        validateString(section.title, `${base}.title`, errors, {max: 300});
        if (!Array.isArray(section.blocks)) issue(errors, `${base}.blocks`, "must be an array");
        section.blocks?.forEach((block, blockIndex) => validateBlock(block, `${base}.blocks[${blockIndex}]`, errors, knownFactIds));
      });
    }
  }

  const onePage = value.onePage;
  if (!onePage || typeof onePage !== "object") {
    issue(errors, "onePage", "must be an object");
  } else {
    for (const field of ["eyebrow", "headline", "deck"]) validateString(onePage[field], `onePage.${field}`, errors);
    if (!Array.isArray(onePage.metrics)) issue(errors, "onePage.metrics", "must be an array");
    onePage.metrics?.forEach((metric, index) => {
      for (const field of ["value", "label", "note"]) validateString(metric?.[field], `onePage.metrics[${index}].${field}`, errors, {allowEmpty: field === "note"});
      validateFactIds(metric?.factIds, `onePage.metrics[${index}].factIds`, errors, knownFactIds, {allowEmpty: false});
    });
    if (!Array.isArray(onePage.modules)) issue(errors, "onePage.modules", "must be an array");
    onePage.modules?.forEach((module, index) => {
      const base = `onePage.modules[${index}]`;
      if (!MODULE_TYPES.has(module?.type)) issue(errors, `${base}.type`, "uses an unsupported module type");
      validateString(module?.title, `${base}.title`, errors);
      if (!Array.isArray(module?.items)) issue(errors, `${base}.items`, "must be an array");
      module?.items?.forEach((item, itemIndex) => {
        validateString(item?.title, `${base}.items[${itemIndex}].title`, errors);
        validateString(item?.body, `${base}.items[${itemIndex}].body`, errors);
        validateFactIds(item?.factIds, `${base}.items[${itemIndex}].factIds`, errors, knownFactIds, {allowEmpty: false});
      });
    });
  }

  const comic = value.comic;
  if (!comic || typeof comic !== "object") {
    issue(errors, "comic", "must be an object");
  } else {
    validateString(comic.title, "comic.title", errors);
    const panelIds = new Set();
    const panelsById = new Map();
    if (!Array.isArray(comic.panels) || comic.panels.length === 0) issue(errors, "comic.panels", "must be a non-empty array");
    comic.panels?.forEach((panel, index) => {
      const base = `comic.panels[${index}]`;
      for (const field of ["id", "scene", "dialogue", "narration"]) validateString(panel?.[field], `${base}.${field}`, errors, {allowEmpty: field === "dialogue"});
      if (typeof panel?.id === "string") {
        if (!ID.test(panel.id) || !panel.id.startsWith("panel-")) issue(errors, `${base}.id`, "must be a lowercase hyphenated panel ID");
        if (panelIds.has(panel.id)) issue(errors, `${base}.id`, "must be unique");
        panelIds.add(panel.id);
        panelsById.set(panel.id, panel);
      }
      validateFactIds(panel?.factIds, `${base}.factIds`, errors, knownFactIds, {allowEmpty: false});
      if (panel?.display !== undefined) validateEditorialDisplay(panel.display, `${base}.display`, errors);
    });
    if (!Array.isArray(comic.pages)) issue(errors, "comic.pages", "must be an array");
    const pageIds = new Set();
    const deliveredPanelIds = [];
    const editorialPanelIds = new Set();
    comic.pages?.forEach((page, index) => {
      const base = `comic.pages[${index}]`;
      validateString(page?.id, `${base}.id`, errors);
      if (typeof page?.id === "string") {
        if (!ID.test(page.id)) issue(errors, `${base}.id`, "must be a lowercase hyphenated ID");
        if (pageIds.has(page.id)) issue(errors, `${base}.id`, "must be unique");
        pageIds.add(page.id);
      }
      const pageFormat = page?.format ?? "image";
      if (!COMIC_PAGE_FORMATS.has(pageFormat)) issue(errors, `${base}.format`, "must be image or editorial");
      validateString(page?.caption, `${base}.caption`, errors, {allowEmpty: true});
      validateFactIds(page?.factIds, `${base}.factIds`, errors, knownFactIds, {allowEmpty: false});
      if (!Array.isArray(page?.panelIds) || page.panelIds.length === 0) issue(errors, `${base}.panelIds`, "must be a non-empty array");
      if (pageFormat === "editorial") {
        validateString(page?.number, `${base}.number`, errors, {max: 20});
        if (typeof page?.number === "string" && !/^\d{2}\/\d{2}$/.test(page.number)) issue(errors, `${base}.number`, "must use NN/NN format");
        for (const forbidden of ["image", "alt", "panelGrid", "subtitles"]) {
          if (page?.[forbidden] !== undefined) issue(errors, `${base}.${forbidden}`, "must be omitted for editorial pages");
        }
        if (!Array.isArray(page?.rows) || page.rows.length === 0) {
          issue(errors, `${base}.rows`, "must be a non-empty array");
        } else {
          const rowPanelIds = [];
          page.rows.forEach((row, rowIndex) => {
            const rowBase = `${base}.rows[${rowIndex}]`;
            if (!row || typeof row !== "object" || Array.isArray(row)) {
              issue(errors, rowBase, "must be an object");
              return;
            }
            if (!EDITORIAL_ROW_LAYOUTS.has(row.layout)) issue(errors, `${rowBase}.layout`, `must be one of: ${[...EDITORIAL_ROW_LAYOUTS.keys()].join(", ")}`);
            if (!Array.isArray(row.panelIds) || row.panelIds.length === 0) {
              issue(errors, `${rowBase}.panelIds`, "must be a non-empty array");
              return;
            }
            const expectedCount = EDITORIAL_ROW_LAYOUTS.get(row.layout);
            if (expectedCount !== undefined && row.panelIds.length !== expectedCount) issue(errors, `${rowBase}.panelIds`, `must contain exactly ${expectedCount} panel IDs for ${row.layout}`);
            for (const panelId of row.panelIds) {
              validateString(panelId, `${rowBase}.panelIds`, errors, {max: 120});
              if (!panelIds.has(panelId)) issue(errors, `${rowBase}.panelIds`, `references an unknown panel: ${panelId}`);
              rowPanelIds.push(panelId);
              editorialPanelIds.add(panelId);
            }
          });
          if (!Array.isArray(page.panelIds) || rowPanelIds.length !== page.panelIds.length || rowPanelIds.some((panelId, panelIndex) => panelId !== page.panelIds[panelIndex])) {
            issue(errors, `${base}.rows`, "must cover every page panel exactly once and in order");
          }
        }
      } else {
        validateImagePath(page?.image, `${base}.image`, errors);
        validateString(page?.alt, `${base}.alt`, errors);
        if (page?.rows !== undefined || page?.number !== undefined) issue(errors, `${base}.rows`, "editorial rows and number require format editorial");
        if (page?.panelGrid !== undefined) {
          if (!page.panelGrid || typeof page.panelGrid !== "object" || Array.isArray(page.panelGrid)) {
            issue(errors, `${base}.panelGrid`, "must be an object when provided");
          } else {
            for (const field of ["columns", "rows"]) {
              const dimension = page.panelGrid[field];
              if (!Number.isInteger(dimension) || dimension < 1 || dimension > 5) {
                issue(errors, `${base}.panelGrid.${field}`, "must be an integer between 1 and 5");
              }
            }
            if (Number.isInteger(page.panelGrid.columns) && Number.isInteger(page.panelGrid.rows) && Array.isArray(page.panelIds)
              && page.panelGrid.columns * page.panelGrid.rows !== page.panelIds.length) {
              issue(errors, `${base}.panelGrid`, "columns multiplied by rows must equal panelIds length");
            }
          }
        }
        if (!Array.isArray(page?.subtitles) || page.subtitles.length === 0) issue(errors, `${base}.subtitles`, "must be a non-empty array");
        if (Array.isArray(page?.panelIds) && Array.isArray(page?.subtitles) && page.panelIds.length !== page.subtitles.length) {
          issue(errors, `${base}.panelIds`, "must have exactly one ordered subtitle per panel ID");
        }
        page?.subtitles?.forEach((subtitle, subtitleIndex) => {
          const subtitleBase = `${base}.subtitles[${subtitleIndex}]`;
          if (!COMIC_SUBTITLE_KINDS.has(subtitle?.kind)) issue(errors, `${subtitleBase}.kind`, "must be narration or dialogue");
          validateString(subtitle?.text, `${subtitleBase}.text`, errors, {max: 300});
          validateString(subtitle?.panelId, `${subtitleBase}.panelId`, errors, {max: 120});
          const expectedPanelId = page?.panelIds?.[subtitleIndex];
          if (typeof subtitle?.panelId === "string" && subtitle.panelId !== expectedPanelId) issue(errors, `${subtitleBase}.panelId`, "must match the panel ID at the same page position");
          if (typeof subtitle?.panelId === "string" && !panelIds.has(subtitle.panelId)) issue(errors, `${subtitleBase}.panelId`, "references an unknown panel");
          validateFactIds(subtitle?.factIds, `${subtitleBase}.factIds`, errors, knownFactIds, {allowEmpty: false});
          const panel = panelsById.get(subtitle?.panelId);
          if (panel && Array.isArray(subtitle?.factIds)) {
            const missing = panel.factIds.filter((factId) => !subtitle.factIds.includes(factId));
            if (missing.length > 0) issue(errors, `${subtitleBase}.factIds`, `must include the panel facts: ${missing.join(", ")}`);
          }
        });
      }
      for (const panelId of page?.panelIds ?? []) {
        if (!panelIds.has(panelId)) issue(errors, `${base}.panelIds`, `references an unknown panel: ${panelId}`);
        deliveredPanelIds.push(panelId);
      }
    });
    if (comic.pages?.length > 0 && (deliveredPanelIds.length !== panelIds.size || deliveredPanelIds.some((panelId, index) => panelId !== comic.panels[index]?.id))) {
      issue(errors, "comic.pages", "must cover every storyboard panel exactly once and in order");
    }
    for (const panelId of editorialPanelIds) {
      const panelIndex = comic.panels?.findIndex((panel) => panel?.id === panelId) ?? -1;
      const panel = panelsById.get(panelId);
      if (!panel?.display) issue(errors, `comic.panels[${panelIndex}].display`, "is required for editorial pages");
    }
  }

  if (expansionMode === "complete") {
    const presentation = auditPresentationCoverage(value);
    if (presentation.missingOnePageFactIds.length > 0) {
      issue(errors, "delivery.expansionMode", `complete mode requires one-page coverage for: ${presentation.missingOnePageFactIds.join(", ")}`);
    }
    if (presentation.missingComicFactIds.length > 0) {
      issue(errors, "delivery.expansionMode", `complete mode requires comic coverage for: ${presentation.missingComicFactIds.join(", ")}`);
    }
  }

  const theme = value.theme;
  if (!theme || typeof theme !== "object") {
    issue(errors, "theme", "must be an object");
  } else {
    for (const field of ["articleTheme", "onePageLayout", "illustrationStyle", "comicStyle", "comicLayout", "palette"]) {
      validateString(theme[field], `theme.${field}`, errors, {max: 120});
    }
    if (!theme.colors || typeof theme.colors !== "object") {
      issue(errors, "theme.colors", "must be an object");
    } else {
      for (const field of ["paper", "surface", "ink", "muted", "accent", "signal"]) {
        if (!HEX_COLOR.test(theme.colors[field] ?? "")) issue(errors, `theme.colors.${field}`, "must be a six-digit hex color");
      }
    }
  }

  validateString(value.markdown, "markdown", errors, {allowEmpty: false, max: 2_000_000});
  if (!value.sourceManifest || typeof value.sourceManifest !== "object") {
    issue(errors, "sourceManifest", "must be an object");
  } else {
    const manifestSourceType = validateSourceType(value.sourceManifest, "sourceManifest.sourceType", errors);
    if (manifestSourceType !== articleSourceType) issue(errors, "sourceManifest.sourceType", "must match article.source.sourceType");
    if (manifestSourceType === "public-url") {
      validateUrl(value.sourceManifest.originalUrl, "sourceManifest.originalUrl", errors);
      if (value.sourceManifest.sourceName !== undefined) validateString(value.sourceManifest.sourceName, "sourceManifest.sourceName", errors, {max: 300});
    } else {
      if (value.sourceManifest.originalUrl !== undefined) issue(errors, "sourceManifest.originalUrl", "must be omitted for pasted-text sources");
      validateString(value.sourceManifest.sourceName, "sourceManifest.sourceName", errors, {max: 300});
      if (value.sourceManifest.sourceName !== article?.source?.name) issue(errors, "sourceManifest.sourceName", "must match article.source.name");
    }
    validateTimestamp(value.sourceManifest.capturedAt, "sourceManifest.capturedAt", errors);
    if (!Array.isArray(value.sourceManifest.assets)) issue(errors, "sourceManifest.assets", "must be an array");
    const manifestPaths = new Set();
    value.sourceManifest.assets?.forEach((asset, index) => {
      const base = `sourceManifest.assets[${index}]`;
      if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
        issue(errors, base, "must be an object");
        return;
      }
      validateImagePath(asset.path, `${base}.path`, errors);
      if (typeof asset.path === "string") {
        if (manifestPaths.has(asset.path)) issue(errors, `${base}.path`, "must be unique");
        manifestPaths.add(asset.path);
      }
      if (!new Set(["original", "ai-generated"]).has(asset.kind)) {
        issue(errors, `${base}.kind`, "must be original or ai-generated");
      }
      validateTimestamp(asset.capturedAt, `${base}.capturedAt`, errors);
      validateString(asset.purpose, `${base}.purpose`, errors, {max: 500});
      if (asset.sourceUrl !== undefined) validateUrl(asset.sourceUrl, `${base}.sourceUrl`, errors);
      if (asset.kind === "original") {
        if (asset.sourceUrl === undefined) issue(errors, `${base}.sourceUrl`, "is required for original assets");
      }
      if (asset.kind === "ai-generated") {
        if (!AI_GENERATION_METHODS.has(asset.generationMethod)) issue(errors, `${base}.generationMethod`, "must be native-imagegen or legacy-unverified");
        validateString(asset.createdFor, `${base}.createdFor`, errors, {max: 120});
        if (asset.createdFor !== article?.slug) issue(errors, `${base}.createdFor`, "must match article.slug");
      }
      if (asset.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(asset.sha256)) issue(errors, `${base}.sha256`, "must be a lowercase SHA-256 hex digest");
      if (asset.format !== undefined && !new Set(["png", "jpeg", "webp"]).has(asset.format)) issue(errors, `${base}.format`, "must be png, jpeg, or webp");
      if (asset.mimeType !== undefined && !new Set(["image/png", "image/jpeg", "image/webp"]).has(asset.mimeType)) issue(errors, `${base}.mimeType`, "must be image/png, image/jpeg, or image/webp");
      for (const field of ["bytes", "width", "height"]) {
        if (asset[field] !== undefined && (!Number.isInteger(asset[field]) || asset[field] < 1)) issue(errors, `${base}.${field}`, "must be a positive integer");
      }
    });
    const references = referencedImagePaths(value);
    for (const referencedPath of references.all) {
      if (!manifestPaths.has(referencedPath)) issue(errors, "sourceManifest.assets", `is missing the referenced image: ${referencedPath}`);
    }
    for (const assetPath of manifestPaths) {
      if (!references.all.includes(assetPath)) issue(errors, "sourceManifest.assets", `contains an unreferenced image: ${assetPath}`);
    }
    for (const comicPath of references.comicImages) {
      const asset = value.sourceManifest.assets?.find((entry) => entry.path === comicPath);
      if (asset?.kind !== "ai-generated") issue(errors, "sourceManifest.assets", `comic image must be ai-generated: ${comicPath}`);
    }
  }
  for (const finding of sensitiveValueFindings(value)) issue(errors, finding.path, `contains a sensitive value pattern: ${finding.pattern}`);
  return errors;
}

export function assertArticlePackage(value) {
  const errors = validateArticlePackage(value);
  if (errors.length > 0) {
    const message = errors.map((error) => `${error.path}: ${error.message}`).join("\n");
    throw new TypeError(`Invalid article package:\n${message}`);
  }
  return value;
}
