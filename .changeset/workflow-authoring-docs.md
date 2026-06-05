---
"@united-workforce/util": patch
---

fix: workflow-authoring docs — add type:object to oneOf examples, clarify const vs enum rules (#123)

- All frontmatter examples include `type: object` (both flat and oneOf)
- Restructure $status section: "Multi-exit (oneOf)" vs "Single-exit (flat schema)"
- Add "Important rules" box: type:object required, const only in oneOf, enum in flat
- Restore "Custom Fields" subsection
