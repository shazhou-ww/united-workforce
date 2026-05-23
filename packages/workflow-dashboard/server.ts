import { createServer } from "vite";

const PORT = 3000;

const server = await createServer({
  server: { port: PORT },
});

await server.listen();
