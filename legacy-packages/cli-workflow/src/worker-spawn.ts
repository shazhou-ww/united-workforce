import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";
import { getWorkerHostScriptPath } from "@uncaged/workflow-execute";
import { err, ok, type Result } from "@uncaged/workflow-protocol";

import { pathExists, readTextFileIfExists } from "./fs-utils.js";
import { readThreadTerminalFromHead, resolveThreadRecord } from "./thread-scan.js";

export type WorkerCtl = {
  pid: number;
  port: number;
};

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForReadyLine(
  childStdout: NodeJS.ReadableStream,
  child: ChildProcess,
): Promise<Result<number, string>> {
  return await new Promise((resolve) => {
    let buf = "";
    let settled = false;

    function finish(result: Result<number, string>): void {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    }

    function onData(chunk: Buffer | string): void {
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl < 0) {
        return;
      }
      const line = buf.slice(0, nl).trim();
      const prefix = "READY ";
      if (!line.startsWith(prefix)) {
        finish(err(`worker did not emit READY line (got: ${line})`));
        return;
      }
      const portText = line.slice(prefix.length);
      const port = Number(portText);
      if (!Number.isFinite(port) || port <= 0) {
        finish(err(`worker READY line had invalid port: ${portText}`));
        return;
      }
      finish(ok(port));
    }

    function onEnd(): void {
      finish(err("worker stdout ended before READY line"));
    }

    function onExit(code: number | null): void {
      finish(err(`worker exited before READY line (code ${code})`));
    }

    function cleanup(): void {
      childStdout.off("data", onData);
      childStdout.off("end", onEnd);
      child.off("exit", onExit);
    }

    childStdout.on("data", onData);
    childStdout.on("end", onEnd);
    child.on("exit", onExit);
  });
}

async function spawnWorkerProcess(
  bundlePath: string,
  storageRoot: string,
  hash: string,
): Promise<Result<{ pid: number; port: number }, string>> {
  const scriptPath = getWorkerHostScriptPath();
  const child = spawn(process.execPath, [scriptPath, bundlePath, storageRoot, hash], {
    stdio: ["ignore", "pipe", "inherit"],
  });

  if (child.stdout === null || child.pid === undefined) {
    return err("failed to spawn worker process");
  }

  const pid = child.pid;
  const ready = await waitForReadyLine(child.stdout, child);
  if (!ready.ok) {
    child.kill();
    return ready;
  }

  child.unref();
  child.stdout.destroy();

  return ok({ pid, port: ready.value });
}

export async function ensureWorkerForHash(
  storageRoot: string,
  hash: string,
  bundlePath: string,
): Promise<Result<{ port: number }, string>> {
  const ctlPath = join(storageRoot, "workers", `${hash}.json`);
  const existingText = await readTextFileIfExists(ctlPath);
  if (existingText !== null) {
    try {
      const ctl = JSON.parse(existingText) as WorkerCtl;
      if (
        typeof ctl.pid === "number" &&
        typeof ctl.port === "number" &&
        ctl.pid > 0 &&
        ctl.port > 0 &&
        isProcessAlive(ctl.pid)
      ) {
        return ok({ port: ctl.port });
      }
    } catch {
      // Corrupt control file — ignore and respawn.
    }
    await unlink(ctlPath).catch(() => {});
  }

  const spawned = await spawnWorkerProcess(bundlePath, storageRoot, hash);
  if (!spawned.ok) {
    return spawned;
  }

  await mkdir(join(storageRoot, "workers"), { recursive: true });
  const ctl: WorkerCtl = { pid: spawned.value.pid, port: spawned.value.port };
  await writeFile(ctlPath, `${JSON.stringify(ctl)}\n`, "utf8");

  return ok({ port: spawned.value.port });
}

export type SendWorkerTcpOptions = {
  awaitResponseLine: boolean;
};

function parseWorkerControlResponseLine(line: string): Result<void, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.trim()) as unknown;
  } catch {
    return err("invalid JSON in worker response");
  }
  if (parsed === null || typeof parsed !== "object") {
    return err("invalid worker response shape");
  }
  const rec = parsed as Record<string, unknown>;
  if (rec.ok === true) {
    return ok(undefined);
  }
  if (rec.ok === false) {
    const message = rec.error;
    if (typeof message === "string") {
      return err(message);
    }
    return err("worker error response missing error string");
  }
  return err("invalid worker response: missing ok field");
}

export async function sendWorkerTcpCommand(
  port: number,
  payload: unknown,
  options: SendWorkerTcpOptions = { awaitResponseLine: false },
): Promise<Result<void, string>> {
  return await new Promise((resolve) => {
    let settled = false;
    let buf = "";
    const socket = createConnection({ host: "127.0.0.1", port }, () => {
      socket.write(`${JSON.stringify(payload)}\n`);
      if (!options.awaitResponseLine) {
        socket.end();
      }
    });

    function finish(result: Result<void, string>): void {
      if (settled) {
        return;
      }
      settled = true;
      if (options.awaitResponseLine && socket.writable) {
        socket.end();
      }
      resolve(result);
    }

    function tryFinishFromBuffer(): void {
      if (!options.awaitResponseLine) {
        return;
      }
      const nl = buf.indexOf("\n");
      if (nl < 0) {
        return;
      }
      finish(parseWorkerControlResponseLine(buf.slice(0, nl)));
    }

    socket.on("data", (chunk: Buffer | string) => {
      if (!options.awaitResponseLine) {
        return;
      }
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      tryFinishFromBuffer();
    });

    socket.on("error", (e) => {
      if (settled) {
        return;
      }
      const message = e instanceof Error ? e.message : String(e);
      finish(err(`failed to send worker command: ${message}`));
    });

    socket.on("close", () => {
      if (options.awaitResponseLine) {
        tryFinishFromBuffer();
        if (!settled) {
          finish(err("worker closed without control response"));
        }
        return;
      }
      finish(ok(undefined));
    });
  });
}

export async function readWorkerCtl(
  storageRoot: string,
  hash: string,
): Promise<Result<WorkerCtl, string>> {
  const ctlPath = join(storageRoot, "workers", `${hash}.json`);
  const ctlText = await readTextFileIfExists(ctlPath);
  if (ctlText === null) {
    return err(`worker control file missing for bundle hash ${hash}`);
  }

  let ctl: WorkerCtl;
  try {
    ctl = JSON.parse(ctlText) as WorkerCtl;
  } catch {
    return err(`corrupt worker control file: ${ctlPath}`);
  }

  if (typeof ctl.port !== "number" || ctl.port <= 0) {
    return err(`invalid worker control file: ${ctlPath}`);
  }

  return ok(ctl);
}

export async function resolveRunningHashForThread(
  storageRoot: string,
  threadId: string,
): Promise<Result<string, string>> {
  const logsRoot = join(storageRoot, "logs");
  if (!(await pathExists(logsRoot))) {
    return err(`thread not running (no logs dir): ${threadId}`);
  }
  const resolved = await resolveThreadRecord(storageRoot, threadId);
  if (resolved !== null) {
    const runningPath = join(logsRoot, resolved.bundleHash, `${threadId}.running`);
    if (!(await pathExists(runningPath))) {
      return err(`thread not running: ${threadId}`);
    }
    const terminal = await readThreadTerminalFromHead(storageRoot, resolved.head);
    if (terminal.kind === "terminal") {
      return err(`thread not running: ${threadId}`);
    }
    return ok(resolved.bundleHash);
  }

  let hashes: string[];
  try {
    hashes = await readdir(logsRoot);
  } catch {
    return err(`thread not running: ${threadId}`);
  }
  for (const hash of hashes) {
    const runningPath = join(logsRoot, hash, `${threadId}.running`);
    if (await pathExists(runningPath)) {
      return ok(hash);
    }
  }
  return err(`thread not running: ${threadId}`);
}
