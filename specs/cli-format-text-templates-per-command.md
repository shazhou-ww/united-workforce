---
scenario: "Each in-scope uwf command produces a useful text template under the default --format text"
feature: cli
tags: [cli, format, text, templates]
---

## Given
- The CLI default format is `"text"`
- Renderers are registered for the in-scope commands listed below

## When
- User runs `uwf thread list` (no arguments)

## Then
- Stdout renders a table or compact list of active threads
- Each row includes: thread ID (ULID), workflow name (or hash), status (`idle`/`running`/`suspended`), current role
- Output is NOT a JSON envelope (no leading `{`)
- Exit code is 0 on success

## Behavior: thread show

### Given
- A thread `<thread-id>` exists in active or history index

### When
- User runs `uwf thread show <thread-id>`

### Then
- Stdout renders a status summary including:
  - Thread ID
  - Status
  - Current role
  - Workflow name or hash
- Output is NOT a JSON envelope
- Exit code is 0 on success

## Behavior: thread start

### Given
- A workflow `<workflow>` is registered or resolvable

### When
- User runs `uwf thread start <workflow> -p "..."`

### Then
- Stdout renders a confirmation line that includes the new thread ID (ULID)
- Output is NOT a JSON envelope
- Exit code is 0 on success

## Behavior: workflow list

### Given
- The user is in a directory where `.workflows/` is discoverable OR has registered workflows globally

### When
- User runs `uwf workflow list`

### Then
- Stdout renders a table of registered workflows
- Each row includes: workflow name, hash, source (local vs registry)
- Output is NOT a JSON envelope
- Exit code is 0 on success

## Behavior: workflow show

### Given
- A workflow named `<workflow>` is resolvable

### When
- User runs `uwf workflow show <workflow>`

### Then
- Stdout renders workflow details including:
  - Name
  - Hash
  - Roles (list)
  - Description (if present)
- Output is NOT a JSON envelope
- Exit code is 0 on success

## Behavior: step list

### Given
- A thread `<thread-id>` has at least one step

### When
- User runs `uwf step list <thread-id>`

### Then
- Stdout renders a step chain summary
- Each row includes: step hash (or short hash), role, status
- Output is NOT a JSON envelope
- Exit code is 0 on success

## Behavior: step show

### Given
- A step hash `<step-hash>` exists in CAS

### When
- User runs `uwf step show <step-hash>`

### Then
- Stdout renders the step's content in a readable form (role, status, output summary)
- Output is NOT a JSON envelope
- Exit code is 0 on success

## Behavior: thread read uses existing markdown renderer

### Given
- A thread `<thread-id>` has at least one step
- `formatThreadReadMarkdown` already renders thread context as markdown

### When
- User runs `uwf thread read <thread-id>`

### Then
- The existing `formatThreadReadMarkdown` output is used as the text template for `thread read`
- Output remains backward compatible with the current `thread read` markdown rendering
- Exit code is 0 on success
