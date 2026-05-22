import { createServer } from "vite";

const PORT = 3000;

const server = await createServer({
  server: { port: PORT },
});

await server.listen();

// biome-ignore lint/nursery/noConsole: CLI user-facing output
console.log(`Workflow UI running at http://localhost:${PORT}`);
