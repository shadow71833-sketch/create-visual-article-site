import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

import {
  VISUAL_CATALOG,
  VISUAL_PRESETS,
  selectVisualProfile,
  validateVisualProfile,
} from "../select-visual-profile.mjs";

test("ships the approved enhanced visual catalog", () => {
  assert.equal(VISUAL_CATALOG.articleThemes.length, 12);
  assert.equal(VISUAL_CATALOG.onePageLayouts.length, 18);
  assert.equal(VISUAL_CATALOG.illustrationStyles.length, 12);
  assert.equal(VISUAL_CATALOG.comicStyles.length, 9);
  assert.equal(VISUAL_CATALOG.comicLayouts.length, 8);
  assert.equal(VISUAL_CATALOG.palettes.length, 10);
  assert.ok(VISUAL_PRESETS.length >= 30);
});

test("selects a deterministic research profile", () => {
  const signals = {
    articleType: "research",
    tone: "analytical",
    density: "high",
    hasTimeline: true,
    hasComparisons: true,
  };
  const first = selectVisualProfile(signals);
  const second = selectVisualProfile(signals);
  assert.deepEqual(first, second);
  assert.equal(first.articleTheme, "research-ledger");
  assert.equal(first.onePageLayout, "linear-progression");
  assert.equal(first.comicStyle, "clear-line");
  assert.equal(first.comicLayout, "standard-page");
  assert.deepEqual(validateVisualProfile(first), []);
});

test("auto-selects varied comic styles and layouts from article signals", () => {
  const profiles = [
    selectVisualProfile({articleType: "research", density: "high"}),
    selectVisualProfile({articleType: "product", tone: "energetic"}),
    selectVisualProfile({articleType: "policy", hasComparisons: false}),
    selectVisualProfile({articleType: "nature", hasTimeline: false}),
    selectVisualProfile({articleType: "technology", tone: "calm"}),
  ];

  assert.ok(new Set(profiles.map(({comicStyle}) => comicStyle)).size >= 4);
  assert.ok(new Set(profiles.map(({comicLayout}) => comicLayout)).size >= 3);
  assert.ok(profiles.every((profile) => validateVisualProfile(profile).length === 0));
});

test("reports unknown and incompatible choices", () => {
  const profile = selectVisualProfile({articleType: "product", tone: "energetic", density: "medium"});
  profile.comicStyle = "unknown-style";
  const errors = validateVisualProfile(profile);
  assert.ok(errors.some((error) => error.path === "comicStyle"));
});

test("keeps linear progression modules in one continuous vertical flow", async () => {
  const css = await readFile(new URL("../../assets/site-template/site.css", import.meta.url), "utf8");
  assert.match(
    css,
    /html\[data-one-page-layout="linear-progression"\] \.one-page-modules\s*\{[^}]*display:\s*block;/s,
  );
  assert.doesNotMatch(
    css,
    /html\[data-one-page-layout="linear-progression"\] \.one-page-modules,\s*html\[data-one-page-layout="timeline"\][^{]+\{[^}]*display:\s*flex;/s,
  );
});

test("places comic subtitles below their panel images and stacks panels on mobile", async () => {
  const css = await readFile(new URL("../../assets/site-template/site.css", import.meta.url), "utf8");
  assert.match(css, /\.comic-panel-visual\s*\{[^}]*position:\s*relative;[^}]*aspect-ratio:\s*1;/s);
  assert.match(css, /\.comic-panel-caption\s*\{[^}]*position:\s*static;/s);
  assert.doesNotMatch(css, /\.comic-panel-overlay/);
  for (const count of [1, 2, 3, 4, 5]) {
    assert.match(css, new RegExp(`\\.comic-grid-columns-${count}\\s*\\{[^}]*grid-template-columns`, "s"));
    assert.match(css, new RegExp(`\\.comic-grid-columns-${count} \\.comic-panel-sheet\\s*\\{[^}]*width:\\s*${count * 100}%`, "s"));
    assert.match(css, new RegExp(`\\.comic-grid-rows-${count} \\.comic-panel-sheet\\s*\\{[^}]*height:\\s*${count * 100}%`, "s"));
  }
  assert.match(css, /@media \(max-width:\s*46rem\)[\s\S]*\.comic-panel-grid\s*\{[^}]*grid-template-columns:\s*1fr;/s);
});

test("uses the approved smaller field-notes typography across all views", async () => {
  const css = await readFile(new URL("../../assets/site-template/site.css", import.meta.url), "utf8");
  assert.match(css, /--display:\s*"Kaiti SC",\s*"STKaiti",\s*"KaiTi",\s*serif;/);
  assert.match(css, /--body:\s*"Songti SC",\s*"STSong",\s*"Noto Serif CJK SC",\s*serif;/);
  assert.match(css, /\.article-hero h1\s*\{[\s\S]*?font-size:\s*clamp\(1\.65rem,\s*3\.2vw,\s*2\.6rem\);/);
  assert.match(css, /\.one-page-hero h1\s*\{[\s\S]*?font-size:\s*clamp\(1\.65rem,\s*4\.8vw,\s*4\.3rem\);/);
  assert.match(css, /\.comic-header h1\s*\{[\s\S]*?font-size:\s*clamp\(1\.65rem,\s*4\.8vw,\s*3\.8rem\);/);
  assert.match(css, /\.article-section p,\s*\.article-section li\s*\{\s*font-size:\s*1rem;\s*line-height:\s*2;/);
});

test("uses the full desktop reading-title width, keeps the hero compact, and leaves other views unchanged", async () => {
  const css = await readFile(new URL("../../assets/site-template/site.css", import.meta.url), "utf8");
  assert.match(css, /\.article-hero\s*\{[\s\S]*?padding:\s*clamp\(1\.5rem,\s*3\.5vw,\s*3rem\);/);
  assert.match(css, /\.article-hero h1\s*\{\s*max-width:\s*none;/);
  assert.doesNotMatch(css, /\.article-hero h1\s*\{[^}]*max-width:\s*\d+ch;/s);
  assert.match(css, /\.article-hero h1\s*\{[^}]*margin:\s*0\.85rem 0 0\.7rem;/s);
  assert.match(css, /\.article-hero h1\s*\{[\s\S]*?font-size:\s*clamp\(1\.65rem,\s*3\.2vw,\s*2\.6rem\);/);
  assert.match(css, /\.article-meta\s*\{[^}]*margin-top:\s*1\.25rem;/s);
  assert.match(css, /\.one-page-hero h1\s*\{[^}]*font-size:\s*clamp\(1\.65rem,\s*4\.8vw,\s*4\.3rem\);/s);
  assert.match(css, /\.comic-header h1\s*\{[^}]*font-size:\s*clamp\(1\.65rem,\s*4\.8vw,\s*3\.8rem\);/s);
});

test("removes consumer-facing fact UI and differentiates editorial module types", async () => {
  const css = await readFile(new URL("../../assets/site-template/site.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.fact-(?:links|chip|list|id|claim|status)/);
  assert.doesNotMatch(css, /\.evidence-rail/);
  assert.doesNotMatch(css, /data-panel-id|\.comic-subtitle::before/);
  assert.match(css, /\.article-shell\s*\{[^}]*width:\s*min\(58rem,\s*calc\(100% - 2rem\)\);/s);
  assert.match(css, /\.one-page-module\[data-module="process"\][\s\S]*?\.module-item::before/s);
  assert.match(css, /\.one-page-module\[data-module="comparison"\][\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
  assert.match(css, /\.one-page-module\[data-module="sources"\][\s\S]*?\.module-item::before/s);
  assert.match(css, /@media \(max-width:\s*46rem\)[\s\S]*\.one-page-module\[data-module="comparison"\] \.module-items\s*\{[^}]*grid-template-columns:\s*1fr;/s);
});
