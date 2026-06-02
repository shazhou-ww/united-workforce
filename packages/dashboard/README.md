# @united-workforce/dashboard

Web graph editor for visualizing and editing workflow YAML definitions.

## Overview

A private alpha web app (not part of the runtime engine stack). Provides a React + `@xyflow/react` canvas for editing workflow roles, conditions, and graph transitions. Uses `@united-workforce/protocol` types for validation and YAML round-tripping.

Planned integration: local `uwf connect` over WebSocket to sync YAML between CLI and the browser editor. The REST API and Elysia backend are currently stubs for development.

**Dependencies:** `@united-workforce/protocol`, `@xyflow/react`, React 19, react-router v7, Vite 8, Tailwind CSS v4, Elysia

## Installation

Monorepo-only ( `"private": true` ). Not published to npm.

```bash
cd packages/dashboard
bun install --no-cache
```

## CLI Usage

Start the Vite dev server (port 3000):

```bash
cd packages/dashboard
bun run dev
```

Build for production:

```bash
bun run build
```

Open `http://localhost:3000` in a browser.

## Internal Structure

```
dashboard/
├── server.ts                 Vite dev server entry (port 3000)
├── vite.config.ts            Vite + React + Tailwind + Elysia plugin
├── vite-dev.ts               Custom Vite plugin
├── index.html
├── components.json           shadcn configuration
├── server/
│   ├── api.ts                Elysia REST API (health + workflow CRUD stub)
│   └── workflow.ts           Workflow file read/write + format conversion
└── src/
    ├── main.tsx              React DOM entry
    ├── app.tsx               Root layout
    ├── router.tsx            Hash-mode routes
    ├── index.css
    ├── lib/utils.ts          Tailwind cn() helper
    ├── components/ui/        shadcn components (button, card, dialog, input, …)
    ├── pages/
    │   ├── home.tsx          Workflow list
    │   ├── detail.tsx        Workflow detail view
    │   └── editor.tsx        Full editor page
    └── editor/               Core graph editor
        ├── flow.tsx          FlowEditor component
        ├── context.tsx       State (useSyncExternalStore + Immer)
        ├── injection.ts      DI container
        ├── type.ts             Internal editor types
        ├── model/              Node/edge state model
        ├── nodes/              Start, role, end node components
        ├── edges/              Conditional edge rendering
        ├── panel/              Toolbar, add/edit panels
        ├── trans/              YAML ↔ graph conversion (trans-in, trans-out, validate)
        ├── layout/             Auto-layout
        └── utils/              Event helpers, click-outside hook
```

## Configuration

| Setting | Default | Notes |
|---------|---------|-------|
| Dev server port | `3000` | Set in `server.ts` |
| Workflow storage (dev) | `tmp/workflow/` | YAML files during development |
| Path alias | `@/` → `src/` | Configured in `vite.config.ts` |

No library API — this package is an application, not importable as a module.
