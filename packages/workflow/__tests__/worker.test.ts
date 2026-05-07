import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCasStore } from "../src/cas.js";
import { createContentMerkleNode, serializeMerkleNode } from "../src/merkle.js";
import { getWorkerHostScriptPath } from "../src/worker-entry-path.js";

const bundleSource = `import { putContentMerkleNode } from "@uncaged/workflow";

export const descriptor = {
  description: "worker-test",
  roles: {
    planner: { description: "planner", schema: {} },
    coder: { description: "coder", schema: {} },
  },
};
export const run = async function* (input, options) {
  const cas = options.cas;
  const has = (r) => input.steps.some((s) => s.role === r);
  if (!has("planner")) {
    const h = await putContentMerkleNode(cas, "p");
    yield { role: "planner", contentHash: h, meta: { plan: input.prompt }, refs: [h] };
  }
  if (!has("coder")) {
    const h = await putContentMerkleNode(cas, "c");
    yield { role: "coder", contentHash: h, meta: { diff: "y" }, refs: [h] };
  }
  return { returnCode: 0, summary: "completed: moderator returned END" };
};
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
        options: { maxRounds: 5, depth: 0 },
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
      ).toBe(4);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  test("run with historical steps + forkSourceThreadId replays then continues", async () => {
    const root = await mkdtemp(join(tmpdir(), "wf-worker-fork-"));
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

      const cas = createCasStore(join(root, "cas"));
      const plannerReplayHash = await cas.put(
        serializeMerkleNode(createContentMerkleNode("p-old")),
      );

      const threadId = "01KQXKW18CT8G75T53R8F4G7YG";
      const srcId = "01SRCMMMMMMMMMMMMMMMMMMMM";
      await sendJson(port, {
        type: "run",
        threadId,
        workflowName: "demo-flow",
        prompt: "hello",
        options: { maxRounds: 5, depth: 0 },
        steps: [
          {
            role: "planner",
            contentHash: plannerReplayHash,
            meta: { plan: "z" },
            refs: [plannerReplayHash],
            timestamp: 555,
          },
        ],
        forkSourceThreadId: srcId,
      });

      const exitCode: number = await new Promise((resolve) => {
        child.on("exit", (code) => resolve(code ?? 1));
      });

      expect(exitCode).toBe(0);

      const dataPath = join(root, "logs", hash, `${threadId}.data.jsonl`);
      const text = await readFile(dataPath, "utf8");
      const lines = text
        .trim()
        .split("\n")
        .filter((l) => l !== "");
      expect(lines.length).toBe(4);
      const start = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
      expect(start.forkFrom).toEqual({ threadId: srcId });
      const replay = JSON.parse(lines[1] ?? "{}") as Record<string, unknown>;
      expect(replay.role).toBe("planner");
      expect(replay.timestamp).toBe(555);
      const coder = JSON.parse(lines[2] ?? "{}") as Record<string, unknown>;
      expect(coder.role).toBe("coder");
      const done = JSON.parse(lines[3] ?? "{}") as Record<string, unknown>;
      expect(done.returnCode).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});
