---
scenario: "SSE consumption keeps only the LAST assistant turn's content as the broker output"
feature: broker
tags: [broker, sumeru, sse, parsing]
---

## Given
- Sumeru's wire format for a `turn` event is one frame:
  ```
  id: <number>
  event: turn
  data: {"type":"@sumeru/turn","value":{"index":N,"role":"assistant"|"user"|"system","content":"...","timestamp":"...","toolCalls":...,"tokens":...,"hash":...}}

  ```
- A single `sendMessage` exchange may emit multiple `turn` frames (assistant deliberation, tool calls, etc.) before the terminating `done` frame
- The broker consumer is concerned ONLY with the assistant's final reply; intermediate assistant turns are still accumulated but only the last one survives

## When
- The SSE stream contains, in order: a `user` turn, three `assistant` turns with content `"draft1"`, `"draft2"`, `"final"`, then a `done` frame

## Then
- `assistantTurnCount` is `3`
- `output` is the string `"final"` (last assistant turn's `content`, exactly as received — no trimming, no JSON parsing, no frontmatter extraction)
- The two earlier assistant turns are discarded (they are NOT concatenated, summarised, or surfaced)
- Non-assistant turns (`user`, `system`) are counted toward total turns but are never returned as `output`
- A `turn` frame with malformed JSON in `data` causes the stream to terminate with an error message like `sumeru SSE turn event has malformed JSON: <first 200 chars>`
- A `turn` frame missing `role` or `content` causes the stream to terminate with the error `sumeru SSE turn event missing role or content`
