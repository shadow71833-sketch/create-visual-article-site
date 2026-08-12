import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const VISUAL_CATALOG = Object.freeze({
  articleThemes: Object.freeze([
    "signal-editorial", "research-ledger", "product-studio", "executive-brief", "learning-notebook", "technical-blueprint",
    "culture-journal", "archive-dossier", "nature-fieldbook", "health-explainer", "data-terminal", "playful-lab",
  ]),
  onePageLayouts: Object.freeze([
    "bento-grid", "dashboard", "comparison-matrix", "linear-progression", "timeline", "hub-spoke", "hierarchical-layers",
    "funnel", "iceberg", "tree-branching", "circular-flow", "winding-roadmap", "bridge", "story-mountain",
    "structural-breakdown", "binary-comparison", "periodic-table", "dense-modules",
  ]),
  illustrationStyles: Object.freeze([
    "technical-editorial", "vector-system", "clear-line", "scientific-plate", "watercolor-field", "pixel-interface",
    "paper-collage", "screen-print", "clay-model", "blueprint-drawing", "hand-drawn-notes", "cinematic-concept",
  ]),
  comicStyles: Object.freeze([
    "editorial-newsprint", "clear-line", "manga-ink", "ink-wash", "chalk-talk", "minimal-geometry", "documentary-realism", "retro-newsprint", "tech-comic",
  ]),
  comicLayouts: Object.freeze([
    "four-panel", "standard-page", "cinematic-wide", "webtoon", "dense-explainer", "splash-page", "mixed-panels", "dialogue-led",
  ]),
  palettes: Object.freeze([
    "cobalt-signal", "graphite-lime", "indigo-coral", "forest-copper", "ocean-citrine",
    "plum-mint", "monochrome-red", "sand-ultramarine", "teal-magenta", "slate-amber",
  ]),
});

const rows = [
  ["research-ledger", "research", "research-ledger", "linear-progression", "scientific-plate", "clear-line", "standard-page", "cobalt-signal"],
  ["evidence-timeline", "research", "signal-editorial", "timeline", "technical-editorial", "documentary-realism", "webtoon", "indigo-coral"],
  ["lab-notebook", "research", "learning-notebook", "dense-modules", "hand-drawn-notes", "chalk-talk", "dense-explainer", "graphite-lime"],
  ["product-signal", "product", "product-studio", "bento-grid", "vector-system", "tech-comic", "mixed-panels", "indigo-coral"],
  ["launch-dashboard", "product", "data-terminal", "dashboard", "pixel-interface", "tech-comic", "cinematic-wide", "graphite-lime"],
  ["terminal-blueprint", "product", "technical-blueprint", "structural-breakdown", "blueprint-drawing", "minimal-geometry", "standard-page", "cobalt-signal"],
  ["boardroom-brief", "business", "executive-brief", "comparison-matrix", "technical-editorial", "documentary-realism", "dialogue-led", "slate-amber"],
  ["market-radar", "business", "data-terminal", "dashboard", "vector-system", "tech-comic", "dense-explainer", "teal-magenta"],
  ["operations-map", "business", "signal-editorial", "winding-roadmap", "clear-line", "clear-line", "webtoon", "cobalt-signal"],
  ["tutorial-path", "education", "learning-notebook", "linear-progression", "hand-drawn-notes", "chalk-talk", "webtoon", "ocean-citrine"],
  ["classroom-cards", "education", "playful-lab", "bento-grid", "clay-model", "minimal-geometry", "four-panel", "plum-mint"],
  ["how-it-works", "education", "technical-blueprint", "structural-breakdown", "vector-system", "clear-line", "standard-page", "sand-ultramarine"],
  ["policy-docket", "policy", "archive-dossier", "hierarchical-layers", "paper-collage", "retro-newsprint", "standard-page", "monochrome-red"],
  ["legal-ledger", "policy", "research-ledger", "comparison-matrix", "technical-editorial", "documentary-realism", "dialogue-led", "slate-amber"],
  ["public-service", "policy", "signal-editorial", "funnel", "vector-system", "clear-line", "four-panel", "ocean-citrine"],
  ["culture-magazine", "culture", "culture-journal", "story-mountain", "paper-collage", "retro-newsprint", "mixed-panels", "plum-mint"],
  ["archival-story", "culture", "archive-dossier", "timeline", "screen-print", "ink-wash", "cinematic-wide", "sand-ultramarine"],
  ["photo-essay", "culture", "culture-journal", "dense-modules", "cinematic-concept", "documentary-realism", "splash-page", "slate-amber"],
  ["nature-fieldnotes", "nature", "nature-fieldbook", "tree-branching", "watercolor-field", "ink-wash", "webtoon", "forest-copper"],
  ["climate-system", "nature", "technical-blueprint", "circular-flow", "scientific-plate", "clear-line", "standard-page", "ocean-citrine"],
  ["ecology-iceberg", "nature", "nature-fieldbook", "iceberg", "paper-collage", "minimal-geometry", "mixed-panels", "forest-copper"],
  ["healthcare-explainer", "health", "health-explainer", "hierarchical-layers", "scientific-plate", "clear-line", "standard-page", "teal-magenta"],
  ["care-pathway", "health", "signal-editorial", "winding-roadmap", "vector-system", "documentary-realism", "webtoon", "ocean-citrine"],
  ["science-atlas", "science", "research-ledger", "periodic-table", "scientific-plate", "clear-line", "dense-explainer", "cobalt-signal"],
  ["data-room", "data", "data-terminal", "dashboard", "pixel-interface", "tech-comic", "dense-explainer", "graphite-lime"],
  ["future-interface", "technology", "product-studio", "hub-spoke", "cinematic-concept", "tech-comic", "cinematic-wide", "teal-magenta"],
  ["cyber-brief", "technology", "data-terminal", "binary-comparison", "blueprint-drawing", "tech-comic", "standard-page", "graphite-lime"],
  ["creator-zine", "creative", "culture-journal", "dense-modules", "screen-print", "retro-newsprint", "mixed-panels", "monochrome-red"],
  ["playful-learning", "creative", "playful-lab", "bridge", "clay-model", "minimal-geometry", "four-panel", "plum-mint"],
  ["incident-review", "operations", "executive-brief", "linear-progression", "technical-editorial", "documentary-realism", "dialogue-led", "slate-amber"],
];

export const VISUAL_PRESETS = Object.freeze(rows.map(([
  name, articleType, articleTheme, onePageLayout, illustrationStyle, comicStyle, comicLayout, palette,
]) => Object.freeze({name, articleType, articleTheme, onePageLayout, illustrationStyle, comicStyle, comicLayout, palette})));

function findPreset(name) {
  return VISUAL_PRESETS.find((preset) => preset.name === name);
}

export function validateVisualProfile(profile) {
  const errors = [];
  const fields = [
    ["articleTheme", "articleThemes"],
    ["onePageLayout", "onePageLayouts"],
    ["illustrationStyle", "illustrationStyles"],
    ["comicStyle", "comicStyles"],
    ["comicLayout", "comicLayouts"],
    ["palette", "palettes"],
  ];
  for (const [field, catalog] of fields) {
    if (!VISUAL_CATALOG[catalog].includes(profile?.[field])) {
      errors.push({path: field, message: `unknown ${field}`});
    }
  }
  return errors;
}

export function selectVisualProfile(signals = {}) {
  const articleType = typeof signals.articleType === "string" ? signals.articleType : "culture";
  let presetName;
  if (articleType === "research") presetName = signals.density === "high" ? "research-ledger" : "evidence-timeline";
  else if (articleType === "product") presetName = signals.tone === "energetic" ? "product-signal" : "terminal-blueprint";
  else if (articleType === "business") presetName = signals.hasTimeline ? "operations-map" : "boardroom-brief";
  else if (articleType === "education") presetName = signals.hasTimeline ? "tutorial-path" : "classroom-cards";
  else if (articleType === "policy") presetName = signals.hasComparisons ? "legal-ledger" : "policy-docket";
  else if (articleType === "nature") presetName = signals.hasTimeline ? "climate-system" : "nature-fieldnotes";
  else if (articleType === "health") presetName = "healthcare-explainer";
  else if (articleType === "science") presetName = "science-atlas";
  else if (articleType === "data") presetName = "data-room";
  else if (articleType === "technology") presetName = signals.tone === "energetic" ? "future-interface" : "cyber-brief";
  else if (articleType === "operations") presetName = "incident-review";
  else presetName = "culture-magazine";

  const preset = findPreset(presetName);
  const profile = {
    preset: preset.name,
    articleTheme: preset.articleTheme,
    onePageLayout: preset.onePageLayout,
    illustrationStyle: preset.illustrationStyle,
    comicStyle: preset.comicStyle,
    comicLayout: preset.comicLayout,
    palette: preset.palette,
  };
  profile.comicStyle = "editorial-newsprint";
  profile.comicLayout = "mixed-panels";
  if (signals.hasTimeline && articleType === "research") profile.onePageLayout = "linear-progression";
  return profile;
}

async function main(argv) {
  if (argv.length !== 1) throw new TypeError("Usage: node select-visual-profile.mjs <signals.json>");
  const signals = JSON.parse(await readFile(argv[0], "utf8"));
  process.stdout.write(`${JSON.stringify(selectVisualProfile(signals), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
