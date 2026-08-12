# Quality gates

## Automated gates

- All `node:test` tests pass.
- `quick_validate.py` accepts the skill metadata and structure.
- `verify-output.mjs` reports `ok: true`.
- `completeness-report.json` reports `ok: true`.
- Exactly three view panels exist.
- The comic view contains at least one delivered page. Editorial pages must map trusted rows to every storyboard panel exactly once and in order; illustrated pages require local page art rather than a storyboard-only fallback.
- Every visible editorial panel or illustrated subtitle expresses all of its matched panel fact IDs.
- Consumer HTML contains no evidence rail and no visible `fact-*` IDs, chips, lists, or labels.
- Complete-expansion packages report one-page and comic fact coverage of exactly 100%, with no missing fact IDs.
- Fresh deterministic re-rendering matches `index.html`, `article.md`, `theme.css`, source manifest, and completeness report exactly.
- No inline event handlers/styles, executable inline scripts, dangerous schemes, remote images/CSS, active embedded elements, missing local resources, stale artifacts, or invalid content package paths exist.

## Content gates

- Title, subtitle, source, date, summary, sections, lists, tables, quotes, and captions match the acquired article.
- Every material number and comparison has a fact ID and supporting URL.
- Promotional claims retain `source-claimed` status unless independently verified.
- One-page and comic views do not introduce claims absent from the ledger.
- Reading-view source text coverage is 100% with zero missing source items.
- Section, table, code-block, and media-link coverage are each 100%.
- Reading-view blocks retain source order and wording; condensation occurs only in one-page and comic views.
- HTML reading content and downloadable Markdown come from the same normalized blocks.

## Visual gates

Inspect approximately 1440 px and 375 px widths:

- no horizontal page overflow;
- no clipped Chinese titles, table cells, buttons, captions, or comic dialogue;
- body text remains comfortably readable;
- the reading view uses one consistent content measure, aligned headings, regular paragraph rhythm, and continuous section flow instead of nested cards;
- the one-page view presents one continuous information story; avoid excessive borders, card fragmentation, repeated section chrome, and large empty gaps;
- the one-page view uses relationship-appropriate module types when the source supports them; for six or more distinct facts, prefer at least three meaningful forms such as process, comparison, and sources instead of one repeated list;
- internal fact IDs remain available to verification but are not exposed anywhere in the consumer-facing HTML;
- the reading title remains editorial rather than poster-like: on the shared desktop template, keep the maximum at `2.6rem`, use the full available hero width for Chinese titles without a `ch` cap, and avoid large unused hero space;
- tables scroll only inside their wrapper on narrow screens, captions stay attached, and media links align as editorial rows;
- the reading view is a centered single-column article without an evidence spine;
- editorial pages read as paced comics rather than reports: use short captions, visible turns, irregular trusted rows, at least three display kinds and three row layouts for multi-page work, and no three consecutive prose panels;
- editorial mobile order matches row order, panels collapse cleanly to one column, page numbers remain visible, and no dialogue, stat, list, or takeaway is clipped;
- illustrated comic images load with non-zero natural width and height, and every subtitle remains visible without clipping;
- when an illustrated page uses `panelGrid`, every subtitle sits below its matching cropped panel image, the crop shows the intended scene, and mobile stacks image-caption pairs in one column;
- in standard mode, sources with at least six factual beats or an editorial multi-page benchmark should prefer 8–12 panels across 2–4 pages; in complete mode, add as many readable 3–5-panel editorial pages as required for 100% comic fact coverage and never count unrelated prose as coverage;
- tabs show selected state and work with keyboard arrows;
- color contrast remains legible;
- reduced-motion users receive no required animation;
- print output removes navigation and avoids splitting critical cards or figures.

## Asset gates

- Original images have provenance and descriptive alt text.
- Editorial comic pages have no image dependency and therefore add no comic asset entries.
- When optional AI images or illustrated comic pages are used, they are marked `native-imagegen`, tied to the current article slug, and not reused from another task.
- Repeated illustrated-comic characters remain recognizably consistent.
- Generated images contain no fabricated logos, facts, or unrequested public figures.
- Wrong bitmap text is regenerated rather than patched.
- Every illustrated comic page path exists locally, is recognizably a comic rather than a text card, passes signature/dimension checks, and is recorded as `ai-generated` in the source manifest.

## Pre-handoff acceptance matrix

Record and inspect all three rows before describing the site as complete:

| View | Required evidence |
|---|---|
| Reading | Source section count plus text, section, table, code, and media coverage |
| One-page | Module count, intended order, desktop/mobile continuity, and complete-mode fact coverage |
| Comic | Page and panel counts; format; row/panel order; display-kind and row-layout variety; desktop/mobile clipping; complete-mode fact coverage; for illustrated pages only, subtitle count and loaded image dimensions |

If any required evidence is missing or any row fails, keep the result in progress and report the exact failure.

## Measurement integrity

Run performance/accessibility auditing only when a suitable tool is available. Record its actual output. Never infer or fabricate a score. If unavailable, report the manual checks and the missing measurement explicitly.
