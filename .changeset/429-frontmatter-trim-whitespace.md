---
"@united-workforce/util": patch
"@united-workforce/util-agent": patch
---

fix(frontmatter): trim leading whitespace before the fence check (#429)

Frontmatter extraction previously required the agent output to begin at
character position 0 with `---`, tolerating no leading characters. Both
independent fence detectors used a bare `startsWith("---")`:

- `splitFrontmatter()` in `@united-workforce/util` (main parse path)
- `extractYamlBlock()` in `@united-workforce/util-agent` (raw-field recovery)

Agents (claude-code especially) routinely emit a leading newline, space, or
BOM before the frontmatter, so `startsWith("---")` was `false`, extraction
failed, and the engine fired a `frontmatter retry` — a full extra agent round
on the slowest steps.

Both detectors now `trimStart()` the leading whitespace (newline / CR / space /
tab / BOM `\uFEFF`) before checking the opening fence, in lockstep so the main
parse and `parseRawFrontmatterFields` never disagree (no dropped fields). The
block itself must still be a complete `---\n...\n---`, and the body is computed
from the stripped string so its content is not corrupted.

Scope is the trim layer only — leading prose, markdown code-fence wrapping, and
regex full-text scanning remain intentionally unhandled. Clean-top outputs parse
byte-for-byte as before (zero regression).
