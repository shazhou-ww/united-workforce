import { describe, expect, spyOn, test } from "bun:test";
import { execFile } from "node:child_process";
import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { AgentFn, ThreadContext } from "@uncaged/workflow";
import { START } from "@uncaged/workflow";
import * as roleLlm from "@uncaged/workflow-role-llm";

import { createCommitterRole } from "../src/committer.js";
import { gitExec } from "../src/git-exec.js";

const execFileAsync = promisify(execFile);

async function git(repo: string, args: string[]): Promise<void> {
  await gitExec(repo, args);
}

async function setupRepoWithRemote(): Promise<{ repo: string }> {
  const base = await mkdtemp(join(tmpdir(), "wf-committer-"));
  const bare = join(base, "origin.git");
  const repo = join(base, "work");
  await mkdir(repo, { recursive: true });
  await mkdir(bare, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: repo, encoding: "utf8" });
  await git(repo, ["config", "user.email", "t@t"]);
  await git(repo, ["config", "user.name", "t"]);
  await writeFile(join(repo, "README.md"), "# hi\n", "utf8");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "-m", "init"]);
  await execFileAsync("git", ["init", "--bare"], { cwd: bare, encoding: "utf8" });
  await git(repo, ["remote", "add", "origin", bare]);
  await git(repo, ["push", "-u", "origin", "HEAD"]);
  return { repo };
}

function makeCtx(): ThreadContext {
  return {
    start: {
      role: START,
      content: "do thing",
      meta: { maxRounds: 10 },
      timestamp: Date.now(),
    },
    steps: [],
  };
}

const provider = { baseUrl: "https://example.com/v1", apiKey: "k", model: "m" };

describe("createCommitterRole", () => {
  test("returns committed false when working tree clean", async () => {
    const { repo } = await setupRepoWithRemote();
    const agent: AgentFn = async () => {
      throw new Error("agent should not run");
    };
    const role = createCommitterRole(
      agent,
      { provider, dryRun: null },
      { cwd: repo, remote: "origin", threadId: null },
    );
    const out = await role(makeCtx());
    expect(out.meta.committed).toBe(false);
  });

  test("dry-run skips pipeline", async () => {
    const agent: AgentFn = async () => {
      throw new Error("agent should not run");
    };
    const role = createCommitterRole(agent, { provider, dryRun: true });
    const out = await role(makeCtx());
    expect(out.content).toBe("[dry-run] committer skipped");
    expect(out.meta).toEqual({ committed: true });
  });

  test("commits and pushes when changes exist", async () => {
    const { repo } = await setupRepoWithRemote();
    await appendFile(join(repo, "README.md"), "\nmore\n", "utf8");

    const spy = spyOn(roleLlm, "extractMetaOrThrow").mockResolvedValue({
      branch: "feat/test-commit",
      message: "feat: add more",
    });

    const agent: AgentFn = async () => "plan text";
    const role = createCommitterRole(
      agent,
      { provider, dryRun: null },
      { cwd: repo, remote: "origin", threadId: null },
    );

    const out = await role(makeCtx());
    expect(out.meta.committed).toBe(true);
    expect(spy).toHaveBeenCalled();

    const branches = await gitExec(repo, ["branch", "--list", "feat/test-commit"]);
    expect(branches).toContain("feat/test-commit");

    const remoteRefs = await gitExec(repo, ["ls-remote", "--heads", "origin", "feat/test-commit"]);
    expect(remoteRefs.trim().length).toBeGreaterThan(0);

    spy.mockRestore();
  });
});
