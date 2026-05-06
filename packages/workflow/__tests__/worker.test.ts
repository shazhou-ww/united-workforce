import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getWorkerHostScriptPath } from "../src/worker-entry-path.js";

const bundleSource = `export default async function* () {
  yield { role: "planner", content: "p", meta: { plan: "x" } };
  yield { role: "coder", content: "c", meta: { diff: "y" } };
  return { returnCode: 0, summary: "completed: moderator returned END" };
}
`;

async function readReadyPort(child: import("node:child_process").ChildProcess): Promise<number> {
  return await new Promise((resolve, reject) => {
    if (child.stdout === null) {
      reject(new Error("missing stdout"));
      return;
    }

    let buf = "";
    function cleanup(): void {
      child.stdout?.off("data", onData);
      child.off("exit", onExit);
    }

    function onData(chunk: Buffer): void {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl < 0) {
        return;
      }
      cleanup();
      const line = buf.slice(0, nl).trim();
      const prefix = "READY ";
      if (!line.startsWith(prefix)) {
        reject(new Error(`unexpected READY line: ${line}`));
        return;
      }
      resolve(Number(line.slice(prefix.length)));
    }

    function onExit(code: number | null): void {
      cleanup();
      reject(new Error(`worker exited before READY (code ${code})`));
    }

    child.stdout.on("data", onData);
    child.on("exit", onExit);
  });
}

async function sendJson(port: number, payload: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(`${JSON.stringify(payload)}\n`);
      socket.end();
    });
    socket.on("error", reject);
    socket.on("close", () => resolve());
  });
}

describe("worker process", () => {
  test("loads bundle, runs a thread over TCP, then exits when idle", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-worker-"));
    try {
      const hash = "C9NMV6V2TQT81";
      await mkdir(join(root, "bundles"), { recursive: true });
      const bundlePath = join(root, "bundles", `${hash}.esm.js`);
      await writeFile(bundlePath, bundleSource, "utf8");

      const scriptPath = getWorkerHostScriptPath();
      const child = spawn(process.execPath, [scriptPath, bundlePath, root, hash], {
        stdio: ["ignore", "pipe", "inherit"],
      });

      if (child.stdout === null) {
        throw new Error("missing stdout");
      }

      const port = await readReadyPort(child);

      const threadId = "01KQXKW18CT8G75T53R8F4G7YG";
      await sendJson(port, {
        type: "run",
        threadId,
        workflowName: "demo-flow",
        prompt: "hello",
        options: { isDryRun: false, maxRounds: 5 },
      });

      const exitCode: number = await new Promise((resolve) => {
        child.on("exit", (code) => resolve(code ?? 1));
      });

      expect(exitCode).toBe(0);

      const dataPath = join(root, "logs", hash, `${threadId}.data.jsonl`);
      const text = await readFile(dataPath, "utf8");
      expect(
        text
          .trim()
          .split("\n")
          .filter((l) => l !== "").length,
      ).toBe(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});
