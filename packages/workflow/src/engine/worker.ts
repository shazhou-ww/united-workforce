import { appendFile, mkdir, unlink, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { ensureUncagedWorkflowSymlink, importWorkflowBundleModule } from "../bundle/index.js";
import { createCasStore } from "../cas/index.js";
import type { RoleOutput, WorkflowFn, WorkflowResult } from "../types.js";
import {
  createLogger,
  err,
  getGlobalCasDir,
  normalizeRefsField,
  ok,
  type Result,
} from "../util/index.js";
import { executeThread } from "./engine.js";
import { createThreadPauseGate } from "./thread-pause-gate.js";
import type { ExecuteThreadIo, PrefilledDiskStep, ThreadPauseGate } from "./types.js";

const bootLog = createLogger({ sink: { kind: "stderr" } });

type RunCommand = {
  type: "run";
  threadId: string;
  workflowName: string;
  prompt: string;
  options: { maxRounds: number; depth: number };
  steps: RoleOutput[];
  /** Timestamps aligned with `steps` for `.data.jsonl` replay; length must match `steps` when non-null. */
  stepTimestamps: number[] | null;
  forkSourceThreadId: string | null;
};

type KillCommand = {
  type: "kill";
  threadId: string;
};

type PauseCommand = {
  type: "pause";
  threadId: string;
};

type ResumeCommand = {
  type: "resume";
  threadId: string;
};

type ControlCommand = RunCommand | KillCommand | PauseCommand | ResumeCommand;

type ThreadHandle = {
  abortController: AbortController;
  pauseGate: ThreadPauseGate;
};

function parseRoleOutputRecord(obj: Record<string, unknown>): RoleOutput | null {
  const role = obj.role;
  const contentHash = obj.contentHash;
  const meta = obj.meta;
  if (typeof role !== "string" || typeof contentHash !== "string") {
    return null;
  }
  if (meta === null || typeof meta !== "object") {
    return null;
  }
  return {
    role,
    contentHash,
    meta: meta as Record<string, unknown>,
    refs: normalizeRefsField(obj.refs),
  };
}

function parseRunStepsPayload(rec: Record<string, unknown>): {
  steps: RoleOutput[];
  stepTimestamps: number[] | null;
} | null {
  const raw = rec.steps;
  if (raw === undefined || raw === null) {
    return { steps: [], stepTimestamps: null };
  }
  if (!Array.isArray(raw)) {
    return null;
  }
  const steps: RoleOutput[] = [];
  const timestamps: number[] = [];
  let anyTimestamp = false;
  for (const item of raw) {
    if (item === null || typeof item !== "object") {
      return null;
    }
    const o = item as Record<string, unknown>;
    const out = parseRoleOutputRecord(o);
    if (out === null) {
      return null;
    }
    steps.push(out);
    const ts = o.timestamp;
    if (ts === undefined) {
      timestamps.push(0);
    } else if (typeof ts === "number") {
      timestamps.push(ts);
      anyTimestamp = true;
    } else {
      return null;
    }
  }
  return {
    steps,
    stepTimestamps: anyTimestamp ? timestamps : null,
  };
}

function parseRunControlPayload(rec: Record<string, unknown>): RunCommand | null {
  const threadId = rec.threadId;
  const workflowName = rec.workflowName;
  const prompt = rec.prompt;
  const options = rec.options;
  if (
    typeof threadId !== "string" ||
    typeof workflowName !== "string" ||
    typeof prompt !== "string"
  ) {
    return null;
  }
  if (options === null || typeof options !== "object") {
    return null;
  }
  const optRec = options as Record<string, unknown>;
  const maxRounds = optRec.maxRounds;
  if (typeof maxRounds !== "number") {
    return null;
  }
  const depthRaw = optRec.depth;
  const depth =
    typeof depthRaw === "number" && Number.isFinite(depthRaw) ? Math.trunc(depthRaw) : 0;
  const parsedSteps = parseRunStepsPayload(rec);
  if (parsedSteps === null) {
    return null;
  }
  const rawFork = rec.forkSourceThreadId;
  let forkSourceThreadId: string | null = null;
  if (rawFork !== undefined && rawFork !== null) {
    if (typeof rawFork !== "string" || rawFork === "") {
      return null;
    }
    forkSourceThreadId = rawFork;
  }
  return {
    type: "run",
    threadId,
    workflowName,
    prompt,
    options: { maxRounds, depth },
    steps: parsedSteps.steps,
    stepTimestamps: parsedSteps.stepTimestamps,
    forkSourceThreadId,
  };
}

function parseLifecycleThreadPayload(
  rec: Record<string, unknown>,
): KillCommand | PauseCommand | ResumeCommand | null {
  const type = rec.type;
  const threadId = rec.threadId;
  if (typeof threadId !== "string") {
    return null;
  }
  if (type === "kill") {
    return { type: "kill", threadId };
  }
  if (type === "pause") {
    return { type: "pause", threadId };
  }
  if (type === "resume") {
    return { type: "resume", threadId };
  }
  return null;
}

function parseControlPayload(payload: unknown): ControlCommand | null {
  if (payload === null || typeof payload !== "object") {
    return null;
  }
  const rec = payload as Record<string, unknown>;
  const lifecycle = parseLifecycleThreadPayload(rec);
  if (lifecycle !== null) {
    return lifecycle;
  }
  if (rec.type === "run") {
    return parseRunControlPayload(rec);
  }
  return null;
}

function parseCommandLine(line: string): ControlCommand | null {
  const trimmed = line.trim();
  if (trimmed === "") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    bootLog("S8KQ3WJP", "worker received invalid JSON control line");
    return null;
  }
  return parseControlPayload(parsed);
}

function isWorkflowFnLike(value: unknown): value is WorkflowFn {
  return typeof value === "function";
}

function writeTcpResponse(socket: Socket | null, result: Result<void, string>): void {
  if (socket === null) {
    return;
  }
  const body = result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
  socket.end(`${JSON.stringify(body)}\n`);
}

function dispatchThreadLifecycleCommand(
  threads: Map<string, ThreadHandle>,
  socket: Socket | null,
  cmd: KillCommand | PauseCommand | ResumeCommand,
): void {
  const handle = threads.get(cmd.threadId);
  if (handle === undefined) {
    writeTcpResponse(socket, err(`thread not found: ${cmd.threadId}`));
    return;
  }
  switch (cmd.type) {
    case "kill":
      handle.abortController.abort();
      bootLog("P9XK2WNQ", `kill requested for thread ${cmd.threadId}`);
      writeTcpResponse(socket, ok(undefined));
      return;
    case "pause": {
      const paused = handle.pauseGate.pause();
      if (!paused.ok) {
        writeTcpResponse(socket, paused);
        return;
      }
      bootLog("K7WQ2NXP", `pause requested for thread ${cmd.threadId}`);
      writeTcpResponse(socket, ok(undefined));
      return;
    }
    case "resume": {
      const resumed = handle.pauseGate.resume();
      if (!resumed.ok) {
        writeTcpResponse(socket, resumed);
        return;
      }
      bootLog("M4YT8HKR", `resume requested for thread ${cmd.threadId}`);
      writeTcpResponse(socket, ok(undefined));
      return;
    }
  }
}

async function readLineFromSocket(socket: Socket): Promise<string | null> {
  return await new Promise((resolve) => {
    let buf = "";
    function onData(chunk: Buffer): void {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        cleanup();
        resolve(buf.slice(0, nl));
      }
    }
    function onEnd(): void {
      cleanup();
      resolve(buf === "" ? null : buf);
    }
    function onError(): void {
      cleanup();
      resolve(null);
    }
    function cleanup(): void {
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
    }
    socket.on("data", onData);
    socket.on("end", onEnd);
    socket.on("error", onError);
  });
}

async function main(): Promise<void> {
  const bundlePath = process.argv[2];
  const storageRoot = process.argv[3];
  const hash = process.argv[4];

  if (
    bundlePath === undefined ||
    storageRoot === undefined ||
    hash === undefined ||
    bundlePath === "" ||
    storageRoot === "" ||
    hash === ""
  ) {
    bootLog("H7XN4MKQ", "worker usage: worker <bundlePath> <storageRoot> <hash>");
    process.exit(2);
    return;
  }

  await ensureUncagedWorkflowSymlink(storageRoot);
  // Dynamic import required: user bundle path resolved at runtime
  const modUnknown: unknown = await importWorkflowBundleModule(bundlePath);
  const modRec = modUnknown as Record<string, unknown>;
  const runExport = modRec.run;
  if (!isWorkflowFnLike(runExport)) {
    bootLog("T4BW9YJX", "workflow bundle must export run as a function (AsyncGenerator workflow)");
    process.exit(2);
    return;
  }
  const workflowFn = runExport;

  const threads = new Map<string, ThreadHandle>();
  let activeThreads = 0;
  let shutdownTimer: ReturnType<typeof setTimeout> | null = null;

  const cas = createCasStore(getGlobalCasDir(storageRoot));

  const workerCtlPath = join(storageRoot, "workers", `${hash}.json`);

  function cancelShutdownTimer(): void {
    if (shutdownTimer !== null) {
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
    }
  }

  function scheduleShutdown(): void {
    cancelShutdownTimer();
    shutdownTimer = setTimeout(() => {
      void unlink(workerCtlPath).catch(() => {});
      process.exit(0);
    }, 150);
  }

  function bumpStart(): void {
    cancelShutdownTimer();
    activeThreads++;
  }

  function bumpDone(): void {
    activeThreads--;
    if (activeThreads <= 0) {
      activeThreads = 0;
      scheduleShutdown();
    }
  }

  async function dispatchCommand(cmd: ControlCommand, socket: Socket | null): Promise<void> {
    if (cmd.type !== "run") {
      dispatchThreadLifecycleCommand(threads, socket, cmd);
      return;
    }

    bumpStart();

    const threadId = cmd.threadId;
    const runningPath = join(storageRoot, "logs", hash, `${threadId}.running`);
    const dataJsonlPath = join(storageRoot, "logs", hash, `${threadId}.data.jsonl`);
    const infoJsonlPath = join(storageRoot, "logs", hash, `${threadId}.info.jsonl`);

    const io: ExecuteThreadIo = {
      threadId,
      hash,
      dataJsonlPath,
      infoJsonlPath,
      cas,
    };

    const existing = threads.get(threadId);
    if (existing !== undefined) {
      existing.abortController.abort();
      threads.delete(threadId);
    }

    const pauseGate = createThreadPauseGate();
    const ac = new AbortController();
    threads.set(threadId, { abortController: ac, pauseGate });

    try {
      await mkdir(dirname(runningPath), { recursive: true });
      await mkdir(dirname(dataJsonlPath), { recursive: true });
      await writeFile(runningPath, "", "utf8");

      const logger = createLogger({ sink: { kind: "file", path: infoJsonlPath } });

      const baseTs = Date.now();
      let prefilledDiskSteps: PrefilledDiskStep[] | null = null;
      if (cmd.steps.length > 0) {
        prefilledDiskSteps = cmd.steps.map((step, i) => {
          const ts = cmd.stepTimestamps?.[i];
          return {
            role: step.role,
            contentHash: step.contentHash,
            meta: step.meta,
            refs: normalizeRefsField(step.refs),
            timestamp: typeof ts === "number" && ts > 0 ? ts : baseTs + i,
          };
        });
      }

      const runResult = await executeThread(
        workflowFn,
        cmd.workflowName,
        { prompt: cmd.prompt, steps: cmd.steps },
        {
          ...cmd.options,
          signal: ac.signal,
          awaitAfterEachYield: () => pauseGate.awaitAfterYield(),
          forkSourceThreadId: cmd.forkSourceThreadId,
          prefilledDiskSteps,
          storageRoot,
        },
        io,
        logger,
      );
      await appendFile(dataJsonlPath, `${JSON.stringify(runResult)}\n`, "utf8");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      bootLog("Q3MN8YKW", `thread ${threadId} failed: ${message}`);
      const failure: WorkflowResult = { returnCode: 1, summary: message, rootHash: "" };
      await appendFile(dataJsonlPath, `${JSON.stringify(failure)}\n`, "utf8").catch(() => {});
    } finally {
      threads.delete(threadId);
      await unlink(runningPath).catch(() => {});
      bumpDone();
      socket?.end();
    }
  }

  if (typeof process.send === "function") {
    process.on("message", (msg: unknown) => {
      const cmd = parseControlPayload(msg);
      if (cmd === null) {
        return;
      }
      void dispatchCommand(cmd, null);
    });
  }

  const server = createServer((socket: Socket) => {
    void (async () => {
      const line = await readLineFromSocket(socket);
      if (line === null) {
        socket.end();
        return;
      }
      const cmd = parseCommandLine(line);
      if (cmd === null) {
        socket.end();
        return;
      }
      await dispatchCommand(cmd, socket);
    })();
  });

  server.on("error", (errObj: Error) => {
    bootLog("W8YK4NPX", `worker server error: ${errObj.message}`);
    process.exit(1);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const addr = server.address();
  if (addr === null || typeof addr === "string") {
    bootLog("R9XK4MNW", "worker failed to bind TCP address");
    process.exit(1);
    return;
  }

  process.stdout.write(`READY ${addr.port}\n`);

  await new Promise<void>(() => {});
}

void main();
