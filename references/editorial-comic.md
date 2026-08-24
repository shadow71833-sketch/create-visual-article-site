# Editorial comic

Use this HTML/CSS format only as an explicit fallback for the 秒懂漫画 view when image generation is unsafe, unavailable, or still fails after bounded retries. Set `delivery.comicMode: "editorial"` before building. The default mode is illustrated and must not be silently replaced by this format. The fallback grammar uses short beats, irregular bordered panels, speech shapes, statistics, sound effects, contrast, and a clear page turn without generated comic images.

## Narrative construction

Plan the comic before writing panel copy:

1. **Setup**: start from the reader's likely assumption or the source problem.
2. **Turn**: reveal the mechanism, contradiction, or unexpected evidence.
3. **Escalation**: add the strongest comparison, risk, or constraint.
4. **Resolution**: state what changes, what remains uncertain, and what the reader should retain.

Give each page one purpose and a page-ending hook. Prefer 3–5 panels per page. In complete mode, add pages until all facts appear visibly; do not overload panels.

## Panel rules

- Put at most two material facts in a normal panel.
- Keep `display.text` near 45 Chinese characters or fewer; the schema hard limit is 80.
- Keep dialogue-like copy short enough to read at a glance.
- Use `detail` for a qualification or source limitation, not a second paragraph.
- Use at least three display kinds and three row layouts across a multi-page comic.
- Do not place three consecutive prose/caption panels.
- Do not expose panel IDs or fact IDs in consumer HTML.
- Map every factual phrase to `panel.factIds`; complete mode requires 100% visible coverage.

## Display kinds

| Kind | Purpose |
|---|---|
| `caption` | Time, place, or setup |
| `bubble` | Direct statement or exchange |
| `thought` | Reader assumption or doubt |
| `shout` | Surprise, challenge, or turn |
| `sfx` | Motion or emphasis such as 唰、咚、轰 |
| `stat` | One decisive number or comparison |
| `list` | Limitations, risks, or conditions |
| `diagram` | Short ordered mechanism or flow |
| `takeaway` | Final synthesis and caveat |
| `prose` | Brief connective explanation |

`tone` is one of `light`, `dark`, `speed`, `focus`, or `halftone`.

## Row layouts

| Layout | Panels | Use |
|---|---:|---|
| `single` | 1 | Opener, major turn, or takeaway |
| `split` | 2 | Balanced comparison |
| `wide-left` | 2 | Main action plus supporting fact |
| `wide-right` | 2 | Supporting setup plus main reveal |
| `triptych` | 3 | Fast sequence or three constraints |
| `focus-left` | 3 | Narrow emphasis plus two explanations |

Mobile rendering collapses every row to one column in source order.

## JSON example

```json
{
  "comic": {
    "title": "从群聊到可追踪协作",
    "panels": [
      {
        "id": "panel-1",
        "scene": "运营同事被群消息包围",
        "dialogue": "又要拉一个群？",
        "narration": "模糊步骤会放大执行不确定性。",
        "factIds": ["fact-uncertainty"],
        "display": {
          "kind": "thought",
          "tone": "speed",
          "kicker": "问题出现",
          "text": "又要拉一个群？",
          "detail": "模糊步骤会放大执行不确定性。"
        }
      }
    ],
    "pages": [
      {
        "id": "comic-page-1",
        "format": "editorial",
        "number": "01/01",
        "caption": "先把问题变成可追踪任务。",
        "factIds": ["fact-uncertainty"],
        "panelIds": ["panel-1"],
        "rows": [
          {"layout": "single", "panelIds": ["panel-1"]}
        ]
      }
    ]
  }
}
```

## Self-check

Reject the comic when any condition is true:

- a page has no question, turn, evidence, or transition role;
- a normal panel carries more than two material facts;
- long paragraphs replace panel pacing;
- layouts repeat without visual hierarchy;
- internal IDs appear in rendered HTML;
- mobile order differs from `panelIds` order;
- complete-mode fact coverage is below 100%;
- the result reads like a report broken into bordered cards rather than a paced editorial comic.
