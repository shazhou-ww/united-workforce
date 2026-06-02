# @united-workforce/util

Shared utilities: encoding, IDs, logging, frontmatter parsing, storage paths, and CLI reference generation.

## Overview

Layer 1 shared infrastructure used across CLI, agent-kit, and agent packages. Provides Crockford Base32 encoding, ULID generation, structured logging with fixed 8-char tags, frontmatter markdown parsing/validation, process-level debug logging, and helpers for the default workflow data directory.

**Dependencies:** none (standalone)

## Installation

```bash
bun add @united-workforce/util
```

## API

All exports come from `src/index.ts`.

### Encoding and IDs

```typescript
function encodeUint64AsCrockford(value: bigint): string
function generateUlid(nowMs: number): string
function extractUlidTimestamp(ulid: string): number | null
```

### Logging

```typescript
function createLogger(options?: { sink: { kind: "stderr" } }): LogFn

type LogFn = (tag: string, message: string) => void
// CreateLoggerOptions and LoggerSink are internal types
```

### Process logger

```typescript
function createProcessLogger(options: CreateProcessLoggerOptions): ProcessLogger

type ProcessLogger = {
  pid: string;
  log: ProcessLogFn;
};

type ProcessLoggerContext = {
  thread: string | null;
  workflow: string | null;
};

type CreateProcessLoggerOptions = {
  storageRoot: string | null;
  context: ProcessLoggerContext;
};

type ProcessLogFn = (
  tag: string,
  msg: string,
  context: Record<string, string> | null,
) => void;
```

### Frontmatter markdown

```typescript
function parseFrontmatterMarkdown(raw: string): ParsedFrontmatterMarkdown
function validateFrontmatter(
  parsed: ParsedFrontmatterMarkdown,
  schema: Record<string, unknown>,
): FrontmatterValidationError[]

type ParsedFrontmatterMarkdown = {
  frontmatter: Record<string, unknown>;
  body: string;
};

type AgentFrontmatter = { /* standard agent frontmatter fields */ };
type FrontmatterScope = string;
type FrontmatterStatus = string;
type FrontmatterValidationError = { path: string; message: string };
```

### Result helpers

```typescript
function ok<T>(value: T): Result<T, never>
function err<E>(error: E): Result<never, E>

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
```

### Storage paths

```typescript
function getDefaultWorkflowStorageRoot(): string
function getGlobalCasDir(storageRoot: string | undefined): string
```

### Refs and misc

```typescript
function normalizeRefsField(value: unknown): string[]
function generateCliReference(): string
function env(name: string, fallback: string): string
```

## Usage

```typescript
import {
  createLogger,
  generateUlid,
  getDefaultWorkflowStorageRoot,
  parseFrontmatterMarkdown,
} from "@united-workforce/util";

const log = createLogger();
log("4KNMR2PX", "Loading workflow...");

const root = getDefaultWorkflowStorageRoot();
const threadId = generateUlid(Date.now());
```

## Internal Structure

```
src/
├── index.ts
├── base32.ts              Crockford Base32 encode/decode
├── ulid.ts                  ULID generation
├── logger.ts                Structured logger
├── process-logger/          Process-level debug log files
├── frontmatter-markdown/    Parse and validate agent frontmatter
├── refs-field.ts            Normalize refs arrays on CAS nodes
├── result.ts                ok / err helpers
├── storage-root.ts          Default ~/.uwf paths
├── env.ts                   Environment variable helper
├── cli-reference.ts         Markdown CLI reference generator
└── types.ts                 LogFn, Result, logger options
```

## Configuration

`getDefaultWorkflowStorageRoot()` resolves to `~/.uwf` unless overridden by environment (see `storage-root.ts`).
