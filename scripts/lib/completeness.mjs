import {assertSourceSnapshot} from "./content-model.mjs";
import {auditPresentationCoverage} from "./presentation-coverage.mjs";

export const COMPLETENESS_THRESHOLDS = Object.freeze({
  textCoverage: 1,
  sectionCoverage: 1,
  tableCoverage: 1,
  codeCoverage: 1,
  mediaCoverage: 1,
});

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function blockText(block) {
  if (["paragraph", "quote", "code"].includes(block?.type)) return normalizeText(block.text);
  if (block?.type === "list") return normalizeText(block.items?.join("\n"));
  if (block?.type === "callout") return normalizeText([block.title, block.text].join("\n"));
  if (block?.type === "table") {
    return normalizeText([
      block.caption ?? "",
      ...(block.headers ?? []),
      ...(block.rows ?? []).flat(),
    ].join("\n"));
  }
  if (block?.type === "image") return normalizeText([block.alt, block.caption ?? ""].join("\n"));
  if (block?.type === "media-link") return normalizeText([block.title, block.text, block.url].join("\n"));
  return "";
}

function canonicalBlock(block, path) {
  const type = normalizeText(block?.type);
  const text = blockText(block);
  return {
    path,
    type,
    text,
    signature: `${type}\u0000${text}`,
    weight: Math.max(text.length, 1),
  };
}

function coverage(matched, total) {
  if (total === 0) return 1;
  return Number((matched / total).toFixed(6));
}

function matchSections(sourceSections, articleSections) {
  const matches = [];
  let articleCursor = 0;
  for (let sourceIndex = 0; sourceIndex < sourceSections.length; sourceIndex += 1) {
    const sourceTitle = normalizeText(sourceSections[sourceIndex].title);
    const articleIndex = articleSections.findIndex((section, index) => index >= articleCursor && normalizeText(section?.title) === sourceTitle);
    if (articleIndex === -1) {
      matches.push({sourceIndex, articleIndex: -1, blockMatches: []});
      continue;
    }
    articleCursor = articleIndex + 1;
    const sourceBlocks = sourceSections[sourceIndex].blocks.map((block, blockIndex) => canonicalBlock(block, `sections[${sourceIndex}].blocks[${blockIndex}]`));
    const articleBlocks = (articleSections[articleIndex].blocks ?? []).map((block, blockIndex) => canonicalBlock(block, `article.sections[${articleIndex}].blocks[${blockIndex}]`));
    const blockMatches = [];
    let blockCursor = 0;
    for (const sourceBlock of sourceBlocks) {
      const matchedIndex = articleBlocks.findIndex((block, index) => index >= blockCursor && block.signature === sourceBlock.signature);
      blockMatches.push({sourceBlock, articleIndex: matchedIndex});
      if (matchedIndex !== -1) blockCursor = matchedIndex + 1;
    }
    matches.push({sourceIndex, articleIndex, blockMatches});
  }
  return matches;
}

function structuralCoverage(matches, type) {
  const relevant = matches.flatMap((section) => section.blockMatches).filter(({sourceBlock}) => sourceBlock.type === type);
  return coverage(relevant.filter(({articleIndex}) => articleIndex !== -1).length, relevant.length);
}

function coverageErrors(metrics, thresholds) {
  return Object.entries(thresholds).flatMap(([key, minimum]) => {
    if (metrics[key] >= minimum) return [];
    return [{
      code: key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
      message: `${key} must be at least ${minimum}, received ${metrics[key]}`,
    }];
  });
}

export function auditCompleteness(sourceSnapshot, articlePackage) {
  assertSourceSnapshot(sourceSnapshot);
  if (!articlePackage?.article || !Array.isArray(articlePackage.article.sections)) throw new TypeError("article package must contain article.sections");

  const matches = matchSections(sourceSnapshot.sections, articlePackage.article.sections);
  const allBlocks = matches.flatMap((section) => section.blockMatches);
  const sourcePreamblePairs = [["preamble.title", sourceSnapshot.preamble.title, articlePackage.article.title]];
  if (Object.hasOwn(sourceSnapshot.preamble, "subtitle")) sourcePreamblePairs.push(["preamble.subtitle", sourceSnapshot.preamble.subtitle, articlePackage.article.subtitle]);
  if (Object.hasOwn(sourceSnapshot.preamble, "summary")) sourcePreamblePairs.push(["preamble.summary", sourceSnapshot.preamble.summary, articlePackage.article.summary]);
  if (Array.isArray(sourceSnapshot.preamble.keyPoints)) {
    sourcePreamblePairs.push(...sourceSnapshot.preamble.keyPoints.map((point, index) => [`preamble.keyPoints[${index}]`, point, articlePackage.article.keyPoints?.[index]]));
  }
  const sourcePreamble = sourcePreamblePairs.map(([path, source, article]) => {
    const normalizedSource = normalizeText(source);
    return {path, source: normalizedSource, article: normalizeText(article), weight: Math.max(normalizedSource.length, 1)};
  });
  const sourceWeight = allBlocks.reduce((total, {sourceBlock}) => total + sourceBlock.weight, 0) + sourcePreamble.reduce((total, item) => total + item.weight, 0);
  const matchedWeight = allBlocks.reduce((total, {sourceBlock, articleIndex}) => total + (articleIndex === -1 ? 0 : sourceBlock.weight), 0) + sourcePreamble.reduce((total, item) => total + (item.source === item.article ? item.weight : 0), 0);
  const matchedSections = matches.filter(({articleIndex}) => articleIndex !== -1).length;
  const presentation = auditPresentationCoverage(articlePackage);
  const metrics = {
    textCoverage: coverage(matchedWeight, sourceWeight),
    sectionCoverage: coverage(matchedSections, sourceSnapshot.sections.length),
    tableCoverage: structuralCoverage(matches, "table"),
    codeCoverage: structuralCoverage(matches, "code"),
    mediaCoverage: structuralCoverage(matches, "media-link"),
    sourceCharacters: sourceWeight,
    matchedCharacters: matchedWeight,
    sourceSections: sourceSnapshot.sections.length,
    matchedSections,
    onePageFactCoverage: presentation.onePageFactCoverage,
    comicFactCoverage: presentation.comicFactCoverage,
  };
  const missing = [
    ...sourcePreamble.filter((item) => item.source !== item.article).map((item) => ({path: item.path, type: "preamble", text: item.source.slice(0, 160)})),
    ...matches.filter(({articleIndex}) => articleIndex === -1).map(({sourceIndex}) => ({
      path: `sections[${sourceIndex}]`,
      type: "section",
      title: sourceSnapshot.sections[sourceIndex].title,
    })),
    ...allBlocks.filter(({articleIndex}) => articleIndex === -1).map(({sourceBlock}) => ({
      path: sourceBlock.path,
      type: sourceBlock.type,
      text: sourceBlock.text.slice(0, 160),
    })),
  ];
  const errors = coverageErrors(metrics, COMPLETENESS_THRESHOLDS);
  if (articlePackage?.delivery?.expansionMode === "complete") {
    if (presentation.missingOnePageFactIds.length > 0) {
      errors.push({
        code: "one-page-fact-coverage",
        message: `complete mode one-page view is missing: ${presentation.missingOnePageFactIds.join(", ")}`,
      });
    }
    if (presentation.missingComicFactIds.length > 0) {
      errors.push({
        code: "comic-fact-coverage",
        message: `complete mode comic view is missing: ${presentation.missingComicFactIds.join(", ")}`,
      });
    }
  }
  if (missing.length > 0 && errors.length === 0) errors.push({code: "missing-content", message: `${missing.length} source item(s) are missing`});
  return {ok: errors.length === 0, errors, metrics, missing, presentation};
}
