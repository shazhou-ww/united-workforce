---
scenario: "Moderator evaluate renders edge prompts and locations using LiquidJS engine"
feature: thread
tags: [moderator, liquidjs, template]
---

## Given
- `packages/cli/src/moderator/evaluate.ts` imports `Liquid` from `liquidjs` (not `mustache`)
- A `Liquid` engine instance is created (no HTML escaping by default — plain text prompts)
- The `evaluate()` function signature remains synchronous (uses `parseAndRenderSync`)

## When
- `evaluate(graph, lastRole, lastOutput)` is called with a graph edge containing a Liquid template prompt like `{{ plan }}`

## Then
- The template is rendered using LiquidJS `parseAndRenderSync(template, lastOutput)`
- Variables resolve to their values from `lastOutput` (e.g. `{{ plan }}` → value of `lastOutput.plan`)
- Missing variables render as empty string (LiquidJS default behavior, no `strictVariables` at runtime)
- If the rendered prompt is empty or whitespace-only, an error Result is returned
- If the `location` field is non-null, it is also rendered with the same LiquidJS engine
- The function's return type and error handling remain unchanged (`Result<EvaluateResult, Error>`)

---

## Given
- The previous `mustache` dependency and `mustache.escape = ...` override are removed

## When
- A template contains HTML-like characters (e.g. `<`, `>`, `&`)

## Then
- Characters pass through unescaped (LiquidJS does not HTML-escape by default, unlike Mustache which required `{{{triple}}}` for unescaped output)
- There is no need for triple-brace syntax — `{{ var }}` always outputs raw text
