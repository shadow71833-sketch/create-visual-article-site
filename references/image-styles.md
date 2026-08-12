# Image and comic styles

## Illustration styles

| Style | Visual grammar | Strong use |
|---|---|---|
| `technical-editorial` | Precise shapes with editorial emphasis | Product and business mechanisms |
| `vector-system` | Clean modular vectors and labeled relationships | Processes and comparisons |
| `clear-line` | Consistent outlines, flat controlled color | Accessible explainers |
| `scientific-plate` | Specimen-like detail, measurement, annotation | Research and science |
| `watercolor-field` | Layered washes with observational linework | Nature and reflective topics |
| `pixel-interface` | Deliberate pixel grid and UI metaphors | Computing and data |
| `paper-collage` | Cut-paper hierarchy and archival texture | Culture and policy |
| `screen-print` | Limited inks, bold registration, tactile grain | Opinion and creative work |
| `clay-model` | Soft physical forms and studio lighting | Friendly learning concepts |
| `blueprint-drawing` | Cyanographic lines and construction marks | Engineering systems |
| `hand-drawn-notes` | Human annotations and diagram shorthand | Tutorials |
| `cinematic-concept` | Controlled lighting and scene-scale storytelling | Future scenarios |

## Comic styles

| Style | Rules |
|---|---|
| `editorial-newsprint` | Default HTML/CSS editorial comic: hard black rules, irregular rows, speech shapes, oversized sound effects, statistic panels, halftone accents, and concise page-ending hooks; no generated art required |
| `clear-line` | Even contours, readable silhouettes, limited texture |
| `manga-ink` | Dynamic black shapes and expressive pacing |
| `ink-wash` | Brush economy, negative space, restrained dialogue |
| `chalk-talk` | Board texture, diagram-led scenes, classroom energy |
| `minimal-geometry` | Abstract characters and shape-based explanations |
| `documentary-realism` | Observational framing, credible environments, quiet acting |
| `retro-newsprint` | Halftone, limited spot color, editorial captions |
| `tech-comic` | Interface overlays, system metaphors, crisp perspective |

## Comic layouts

| Layout | Use |
|---|---|
| `four-panel` | One concise setup-development-turn-resolution sequence |
| `standard-page` | Balanced explanation across a conventional page |
| `cinematic-wide` | Environment and scale are essential |
| `webtoon` | Mobile-first vertical pacing |
| `dense-explainer` | Many connected factual steps |
| `splash-page` | One decisive visual thesis |
| `mixed-panels` | Alternating explanation and dramatic moments |
| `dialogue-led` | Two perspectives clarify a difficult idea |

## Palettes

`cobalt-signal`, `graphite-lime`, `indigo-coral`, `forest-copper`, `ocean-citrine`, `plum-mint`, `monochrome-red`, `sand-ultramarine`, `teal-magenta`, and `slate-amber` are paired accent systems. Derive six accessible site tokens from the chosen pair; avoid placing two bright accents behind text simultaneously.

## Image-generation prompt requirements

These requirements apply only to optional article illustrations or an explicitly requested illustrated-comic branch. The default `editorial-newsprint` comic is semantic HTML/CSS and needs no image-generation prompt.

When image generation is used, state the visual purpose, factual constraints, composition, style, palette, language, aspect ratio, recurring-character details, and prohibited inventions. Favor little or no on-image text. Put exact facts and long explanations in HTML captions below the artwork. For a strict regular grid, request consistent gutters and declare the matching `panelGrid`; do not reserve artwork space for text overlays because captions render outside the image.
