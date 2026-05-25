---
description: Ban dynamic import() in production code — use static imports instead
globs: packages/*/src/**/*.ts
alwaysApply: true
---

# No Dynamic Import in Production Code

## Rule

Do NOT use `await import()` or dynamic `import()` expressions in production source code.
Always use static top-level `import` statements.

## Exception (must include a comment explaining why)

1. **Bundle loader** — loads user-authored workflow bundles whose paths are only known at runtime

When suppressing, add a comment directly above:

```ts
// Dynamic import required: user bundle path resolved at runtime
const mod = await import(bundlePath);
```

## Test Files

Test files (`__tests__/**`) are exempt.
