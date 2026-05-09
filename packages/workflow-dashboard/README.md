# @uncaged/workflow-dashboard

Web dashboard for the Uncaged Workflow engine. Connects to the local
`uncaged-workflow serve` API to display threads, workflows, and CAS data.

## Development

```bash
# Start the local API server (in another terminal)
uncaged-workflow serve

# Start the dashboard dev server
bun run dev
```

Opens at http://localhost:5173. Vite proxies `/api/*` to `localhost:7860`.

## Build

```bash
bun run build
```

Output goes to `dist/` — static files ready for CF Pages or any host.
