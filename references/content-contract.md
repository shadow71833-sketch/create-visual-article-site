# Content contract

## Purpose

Use one versioned JSON package as the only input to the static builder. Source HTML is never a valid field.

## Top-level fields

| Field | Required content |
|---|---|
| `version` | Integer `2` |
| `generatedAt` | ISO-8601 timestamp |
| `delivery` | Optional delivery settings; use `{ "expansionMode": "complete" }` for complete expansion |
| `article` | Reading-view content and source metadata |
| `facts` | Stable claim-to-source ledger |
| `onePage` | Responsive summary modules |
| `comic` | Storyboard plus delivered editorial or illustrated pages |
| `theme` | Catalog choices and six color tokens |
| `markdown` | Compatibility input only; builder replaces it with full generated Markdown |
| `sourceManifest` | Source type, capture time, and asset provenance |

## Article

Use a lowercase hyphenated `slug`, non-empty `title`, optional `subtitle`, positive `readingMinutes`, concise `summary`, and `keyPoints`. `source` always requires `name` and boolean `verified`.

- Public pages use `sourceType: "public-url"` (or omit it for backward compatibility) and require a public HTTP(S) `url` plus `publishedAt`.
- Pasted text uses `sourceType: "pasted-text"`, omits `url`, and may omit `publishedAt`. The default source name is a truthful label such as `用户提供原文`.

Each section requires a stable `id`, title, and ordered blocks. Supported block types:

| Type | Required fields |
|---|---|
| `paragraph` | `text` |
| `list` | `items`; optional `ordered` |
| `table` | equal-width `headers` and `rows`; optional `caption` |
| `quote` | `text`; optional `factIds` |
| `image` | safe relative `src`, meaningful `alt`; optional `caption`, `factIds` |
| `callout` | `title`, `text`; optional `tone`, `factIds` |
| `code` | `text` |
| `media-link` | `title`, `text`, public HTTP(S) `url`; optional `factIds` |

Never create `html`, `raw-html`, `video`, `iframe`, `embed`, or executable block types. Preserve videos and other remote media as `media-link` blocks rather than active embeds.

## Source snapshot

Create `source-snapshot.json` before summaries. It requires `version: 2`, `capturedAt`, a preamble title, and ordered sections with stable IDs. Public sources require `canonicalUrl`; pasted text requires `sourceType: "pasted-text"` and `sourceName` while omitting `canonicalUrl`. Subtitle, summary, and key points are compared when the source actually supplies them. Snapshot sections use the same titles and supported reading blocks as `article.sections`, excluding fact IDs and local asset bookkeeping.

The completeness auditor treats snapshot blocks as an ordered source of truth. The reading view may insert explanatory visuals, but it must preserve 100% of source text, sections, tables, code blocks, and media links, in order, with zero missing items.

## Facts

Each fact requires:

- unique `id` such as `fact-7`;
- self-contained `claim`;
- public `sourceUrl` that supports that exact claim for public pages, or `sourceRef: "source-snapshot"` for pasted text;
- status: `verified`, `source-claimed`, or `unverified`.

Fact references in article blocks, every one-page metric/item, comic panels, comic pages, visible editorial displays, and legacy illustrated subtitles must point to existing IDs. Fact arrays used by the summary and comic views must be non-empty and contain no duplicate IDs.

## Delivery mode

Omitting `delivery` is equivalent to `expansionMode: "standard"`. Set `delivery.expansionMode` to `complete` when the user asks for `完整展开`, complete content, no omissions, or more expansion. Complete mode requires every fact ID in the ledger to appear in at least one one-page metric/item and in at least one visible delivered comic panel. Validation fails with exact missing fact IDs when either view is incomplete.

## Markdown

Treat an input `markdown` field as non-authoritative compatibility data. The builder must generate `article.md` and the embedded copy/download payload from `article.sections`; a separately authored summary is invalid as the downloadable full article.

## One-page view

Provide `eyebrow`, `headline`, `deck`, metrics, and modules. A metric has `value`, `label`, `note`, and non-empty `factIds`. A module type is one of `cards`, `timeline`, `comparison`, `process`, `risks`, `sources`, or `quote`; each item has `title`, `body`, and non-empty `factIds`.

Keep modules scannable. Move long explanations to the reading view.

## Comic

`panels` is always present. Each panel requires a unique `panel-*` ID, `scene`, `dialogue`, `narration`, and non-empty `factIds`. Across all delivered pages, panel IDs must cover the storyboard exactly once and in order.

The default editorial format adds `display` to each visible panel. `display.kind` is one of `caption`, `bubble`, `thought`, `shout`, `sfx`, `stat`, `list`, `diagram`, `takeaway`, or `prose`; `tone` is optionally `light`, `dark`, `speed`, `focus`, or `halftone`. `text` is required. `kicker`, `detail`, and `mark` are optional. `list` and `diagram` require non-empty `items`.

An editorial page requires `format: "editorial"`, a `number` in `NN/NN` form, caption, non-empty fact IDs, ordered `panelIds`, and non-empty `rows`. A row uses `layout` plus ordered `panelIds`. Layouts are `single` (1), `split` (2), `wide-left` (2), `wide-right` (2), `triptych` (3), and `focus-left` (3). Flattened row IDs must equal the page's `panelIds` exactly. Editorial pages omit `image`, `alt`, `subtitles`, and `panelGrid`.

Legacy illustrated pages remain supported. They require a safe local `image`, descriptive `alt`, caption, non-empty fact IDs, ordered `panelIds`, and exactly one escaped HTML subtitle per listed panel. A strict regular image sheet may add `panelGrid` with integer `columns` and `rows` from 1 through 5 whose product equals `panelIds.length`.

## Theme

Choose catalog values for `articleTheme`, `onePageLayout`, `illustrationStyle`, `comicStyle`, `comicLayout`, and `palette`. Colors require uppercase or lowercase six-digit hex values for `paper`, `surface`, `ink`, `muted`, `accent`, and `signal`.

## Source manifest assets

Record the same source type as `article.source`. Public manifests require `originalUrl`; pasted-text manifests require `sourceType: "pasted-text"` and a matching `sourceName`, and must omit `originalUrl`. Record exactly the images referenced by article blocks and legacy illustrated comic pages—no orphan files—with a safe `assets/` path, `kind`, capture time, and purpose. Editorial comic pages add no asset entry. Original assets require a public `sourceUrl`. AI assets require `generationMethod: "native-imagegen"` and `createdFor` equal to `article.slug`; `legacy-unverified` exists only for migration review and cannot pass a final build. The builder records SHA-256, byte size, format, MIME type, width, and height after inspecting each local file. Only PNG, JPEG, and WebP are accepted. Do not store cookies, signed URLs, API keys, prompts containing secrets, or local browser profile paths.
