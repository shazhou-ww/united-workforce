import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { stringify } from "yaml";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(TEST_DIR, "..", "..", "dist", "cli.js");

// ── helpers ──────────────────────────────────────────────────────────────────

type RunResult = { stdout: string; stderr: string; exitCode: number };

function runValidate(
  filePath: string,
  extraArgs: string[] = [],
  envOverride?: NodeJS.ProcessEnv,
): RunResult {
  const args = [CLI_PATH, "workflow", "validate", filePath, ...extraArgs];
  try {
    const stdout = execFileSync(process.execPath, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: envOverride ?? process.env,
      timeout: 15_000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      status?: number;
    };
    return {
      stdout: typeof err.stdout === "string" ? err.stdout : (err.stdout?.toString() ?? ""),
      stderr: typeof err.stderr === "string" ? err.stderr : (err.stderr?.toString() ?? ""),
      exitCode: err.status ?? 1,
    };
  }
}

function runCli(args: string[]): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [CLI_PATH, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      timeout: 15_000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      status?: number;
    };
    return {
      stdout: typeof err.stdout === "string" ? err.stdout : (err.stdout?.toString() ?? ""),
      stderr: typeof err.stderr === "string" ? err.stderr : (err.stderr?.toString() ?? ""),
      exitCode: err.status ?? 1,
    };
  }
}

/** Build a valid single-role workflow payload (writer→$END, status `done`). */
function makeMinimalPayload(name: string): unknown {
  return {
    name,
    description: `${name} workflow`,
    roles: {
      writer: {
        description: "Writes content",
        goal: "Write content",
        capabilities: ["writing"],
        procedure: "Write it",
        output: "The content",
        frontmatter: {
          type: "object",
          properties: {
            $status: { const: "done" },
          },
          required: ["$status"],
        },
      },
    },
    graph: {
      $START: {
        new: { role: "writer", prompt: "Begin", location: null },
        resume: { role: "writer", prompt: "Resume", location: null },
      },
      writer: { done: { role: "$END", prompt: "Done", location: null } },
    },
  };
}

/** Build a valid writer→reviewer workflow with mustache var. */
function makeMultiRolePayload(name: string): unknown {
  return {
    name,
    description: `${name} workflow`,
    roles: {
      writer: {
        description: "Writes content",
        goal: "Write content",
        capabilities: ["writing"],
        procedure: "Write it",
        output: "The content",
        frontmatter: {
          type: "object",
          properties: {
            $status: { const: "done" },
            plan: { type: "string" },
          },
          required: ["$status", "plan"],
        },
      },
      reviewer: {
        description: "Reviews content",
        goal: "Review content",
        capabilities: ["reviewing"],
        procedure: "Review it",
        output: "The review",
        frontmatter: {
          type: "object",
          properties: {
            $status: { const: "approved" },
            summary: { type: "string" },
          },
          required: ["$status", "summary"],
        },
      },
    },
    graph: {
      $START: {
        new: { role: "writer", prompt: "Begin writing", location: null },
        resume: { role: "writer", prompt: "Continue", location: null },
      },
      writer: {
        done: { role: "reviewer", prompt: "Review this: {{ plan }}", location: null },
      },
      reviewer: {
        approved: { role: "$END", prompt: "Done: {{ summary }}", location: null },
      },
    },
  };
}

/** Build a valid reviewer with oneOf multi-exit. */
function makeOneOfPayload(name: string): unknown {
  return {
    name,
    description: `${name} workflow`,
    roles: {
      writer: {
        description: "Writes content",
        goal: "Write",
        capabilities: ["writing"],
        procedure: "Write",
        output: "Content",
        frontmatter: {
          type: "object",
          properties: {
            $status: { const: "done" },
            plan: { type: "string" },
          },
          required: ["$status", "plan"],
        },
      },
      reviewer: {
        description: "Reviews",
        goal: "Review",
        capabilities: ["reviewing"],
        procedure: "Review",
        output: "Review",
        frontmatter: {
          type: "object",
          oneOf: [
            {
              properties: {
                $status: { const: "approved" },
                summary: { type: "string" },
              },
              required: ["$status", "summary"],
            },
            {
              properties: {
                $status: { const: "rejected" },
                reason: { type: "string" },
              },
              required: ["$status", "reason"],
            },
          ],
        },
      },
    },
    graph: {
      $START: {
        new: { role: "writer", prompt: "Begin", location: null },
        resume: { role: "writer", prompt: "Resume", location: null },
      },
      writer: {
        done: { role: "reviewer", prompt: "Review: {{ plan }}", location: null },
      },
      reviewer: {
        approved: { role: "$END", prompt: "Done: {{ summary }}", location: null },
        rejected: { role: "writer", prompt: "Fix: {{ reason }}", location: null },
      },
    },
  };
}

let tmpDir: string;

beforeAll(() => {
  // Confirm CLI is built before running tests
  // (proman build should have produced dist/cli.js)
});

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "wf-validate-test-"));
});

afterEach(async () => {
  // chmod back in case a test modified a directory
  try {
    await chmod(tmpDir, 0o755);
  } catch {
    // ignore
  }
  await rm(tmpDir, { recursive: true, force: true });
});

// ── Suite A: Success Path ────────────────────────────────────────────────────

describe("workflow validate — Suite A: Success Path", () => {
  test("A.1 valid single-role workflow exits 0 silent", async () => {
    const file = join(tmpDir, "test-wf.yaml");
    await writeFile(file, stringify(makeMinimalPayload("test-wf")));

    const result = runValidate(file);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("A.2 valid multi-role workflow with mustache vars exits 0 silent", async () => {
    const file = join(tmpDir, "writer-flow.yaml");
    await writeFile(file, stringify(makeMultiRolePayload("writer-flow")));

    const result = runValidate(file);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("A.3 valid oneOf multi-exit workflow exits 0 silent", async () => {
    const file = join(tmpDir, "review-flow.yaml");
    await writeFile(file, stringify(makeOneOfPayload("review-flow")));

    const result = runValidate(file);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("A.4 !include tag resolution against YAML directory", async () => {
    const subDir = join(tmpDir, "sub");
    await mkdir(subDir, { recursive: true });

    // The include payload is the workflow's roles section
    const rolesYaml = stringify({
      writer: {
        description: "Writes",
        goal: "Write",
        capabilities: ["writing"],
        procedure: "Write",
        output: "Content",
        frontmatter: {
          type: "object",
          properties: {
            $status: { const: "done" },
          },
          required: ["$status"],
        },
      },
    });
    await writeFile(join(subDir, "roles.yaml"), rolesYaml);

    const mainYaml = `name: main-wf
description: Main workflow
roles: !include sub/roles.yaml
graph:
  $START:
    new: { role: writer, prompt: Begin, location: null }
    resume: { role: writer, prompt: Resume, location: null }
  writer:
    done: { role: $END, prompt: Done, location: null }
`;
    const file = join(tmpDir, "main-wf.yaml");
    await writeFile(file, mainYaml);

    const result = runValidate(file);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("A.5 --format yaml does not change silent success output", async () => {
    const file = join(tmpDir, "test-wf.yaml");
    await writeFile(file, stringify(makeMinimalPayload("test-wf")));

    // --format is a global option on `program`, must come before the subcommand
    const args = [CLI_PATH, "--format", "yaml", "workflow", "validate", file];
    let result: RunResult;
    try {
      const stdout = execFileSync(process.execPath, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
        timeout: 15_000,
      });
      result = { stdout, stderr: "", exitCode: 0 };
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException & {
        stdout?: string | Buffer;
        stderr?: string | Buffer;
        status?: number;
      };
      result = {
        stdout: typeof err.stdout === "string" ? err.stdout : (err.stdout?.toString() ?? ""),
        stderr: typeof err.stderr === "string" ? err.stderr : (err.stderr?.toString() ?? ""),
        exitCode: err.status ?? 1,
      };
    }

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});

// ── Suite B: File / IO Errors ────────────────────────────────────────────────

describe("workflow validate — Suite B: File / IO Errors", () => {
  test("B.1 missing file exits 1 with file-not-found error", () => {
    const file = join(tmpDir, "does-not-exist.yaml");
    const result = runValidate(file);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("file not found:");
    expect(result.stderr).toContain(file);
  });

  test("B.2 directory passed as file exits 1 with non-empty stderr", () => {
    const result = runValidate(tmpDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});

// ── Suite C: YAML / Shape Errors ─────────────────────────────────────────────

describe("workflow validate — Suite C: YAML / Shape Errors", () => {
  test("C.1 malformed YAML exits 1 with 'invalid YAML' prefix", async () => {
    const file = join(tmpDir, "broken.yaml");
    await writeFile(file, ":::: not yaml ::::");

    const result = runValidate(file);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("invalid YAML:");
  });

  test("C.2 valid YAML but wrong shape exits 1 with WorkflowPayload error", async () => {
    const file = join(tmpDir, "wrong-shape.yaml");
    await writeFile(file, stringify({ hello: "world" }));

    const result = runValidate(file);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid workflow YAML: expected WorkflowPayload shape");
  });

  test("C.3 empty file exits 1", async () => {
    const file = join(tmpDir, "empty.yaml");
    await writeFile(file, "");

    const result = runValidate(file);

    expect(result.exitCode).toBe(1);
    // either "invalid YAML:" or the WorkflowPayload-shape error is acceptable
    const okMessage =
      result.stderr.includes("invalid YAML:") || result.stderr.includes("invalid workflow YAML:");
    expect(okMessage).toBe(true);
  });
});

// ── Suite D: Filename Consistency ────────────────────────────────────────────

describe("workflow validate — Suite D: Filename Consistency", () => {
  test("D.1 name mismatch with filename exits 1", async () => {
    const file = join(tmpDir, "foo-bar.yaml");
    // write a payload whose name is baz-qux, file is foo-bar
    await writeFile(file, stringify(makeMinimalPayload("baz-qux")));

    const result = runValidate(file);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("workflow name mismatch:");
    expect(result.stderr).toContain("foo-bar");
    expect(result.stderr).toContain("baz-qux");
  });

  test("D.2 index.yaml accepts directory name as workflow name", async () => {
    const dir = join(tmpDir, "my-flow");
    await mkdir(dir, { recursive: true });
    const file = join(dir, "index.yaml");
    await writeFile(file, stringify(makeMinimalPayload("my-flow")));

    const result = runValidate(file);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});

// ── Suite E: Semantic Errors ─────────────────────────────────────────────────

describe("workflow validate — Suite E: Semantic Errors", () => {
  test("E.1 graph prompt references variable absent from frontmatter", async () => {
    const payload = {
      name: "comment-pr",
      description: "Comment on PR",
      roles: {
        commenter: {
          description: "Commenter",
          goal: "Comment",
          capabilities: ["commenting"],
          procedure: "Comment",
          output: "Comment",
          // NB: no `prNumber` property declared
          frontmatter: {
            type: "object",
            properties: {
              $status: { const: "approved" },
            },
            required: ["$status"],
          },
        },
      },
      graph: {
        $START: {
          new: { role: "commenter", prompt: "Begin", location: null },
          resume: { role: "commenter", prompt: "Resume", location: null },
        },
        commenter: {
          approved: {
            role: "$END",
            prompt: "Comment on PR #{{ prNumber }}",
            location: null,
          },
        },
      },
    };
    const file = join(tmpDir, "comment-pr.yaml");
    await writeFile(file, stringify(payload));

    const result = runValidate(file);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("workflow validation failed:");
    expect(result.stderr).toContain('template variable "prNumber"');
    expect(result.stderr).toContain("commenter");
  });

  test("E.2 multi-exit oneOf variant prompt references variable not in that variant", async () => {
    const payload = {
      name: "review-bad",
      description: "Bad review",
      roles: {
        writer: {
          description: "Writes",
          goal: "Write",
          capabilities: ["writing"],
          procedure: "Write",
          output: "Content",
          frontmatter: {
            type: "object",
            properties: {
              $status: { const: "done" },
              plan: { type: "string" },
            },
            required: ["$status", "plan"],
          },
        },
        reviewer: {
          description: "Reviews",
          goal: "Review",
          capabilities: ["reviewing"],
          procedure: "Review",
          output: "Review",
          frontmatter: {
            type: "object",
            oneOf: [
              {
                properties: {
                  $status: { const: "approved" },
                  summary: { type: "string" },
                },
                required: ["$status", "summary"],
              },
              {
                properties: {
                  $status: { const: "rejected" },
                  reason: { type: "string" },
                },
                required: ["$status", "reason"],
              },
            ],
          },
        },
      },
      graph: {
        $START: {
          new: { role: "writer", prompt: "Begin", location: null },
          resume: { role: "writer", prompt: "Resume", location: null },
        },
        writer: { done: { role: "reviewer", prompt: "Review: {{ plan }}", location: null } },
        reviewer: {
          // approved branch references {{ reason }} which only exists in rejected variant
          approved: { role: "$END", prompt: "Approved because: {{ reason }}", location: null },
          rejected: { role: "writer", prompt: "Fix: {{ reason }}", location: null },
        },
      },
    };
    const file = join(tmpDir, "review-bad.yaml");
    await writeFile(file, stringify(payload));

    const result = runValidate(file);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('template variable "reason"');
    expect(result.stderr).toContain('variant "approved"');
  });

  test("E.3 graph references unknown role", async () => {
    const payload = makeMinimalPayload("orphan-graph") as Record<string, unknown>;
    const graph = payload.graph as Record<string, unknown>;
    graph.bogus = { done: { role: "$END", prompt: "x", location: null } };

    const file = join(tmpDir, "orphan-graph.yaml");
    await writeFile(file, stringify(payload));

    const result = runValidate(file);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('unknown role "bogus"');
  });

  test("E.4 $START missing resume edge", async () => {
    const payload = makeMinimalPayload("no-resume") as Record<string, unknown>;
    const graph = payload.graph as Record<string, Record<string, unknown>>;
    graph.$START = {
      new: { role: "writer", prompt: "Begin", location: null },
      // no resume edge
    };

    const file = join(tmpDir, "no-resume.yaml");
    await writeFile(file, stringify(payload));

    const result = runValidate(file);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('$START must have edges with statuses "new" and "resume"');
  });

  test("E.5 unreachable role exits 1", async () => {
    const payload = makeMultiRolePayload("unreachable") as Record<string, unknown>;
    // add an extra role that is in roles + graph but no edge points to it
    const roles = payload.roles as Record<string, unknown>;
    roles.orphan = {
      description: "Orphan",
      goal: "nothing",
      capabilities: [],
      procedure: "none",
      output: "none",
      frontmatter: {
        type: "object",
        properties: { $status: { const: "done" } },
        required: ["$status"],
      },
    };
    const graph = payload.graph as Record<string, Record<string, unknown>>;
    graph.orphan = { done: { role: "$END", prompt: "ok", location: null } };

    const file = join(tmpDir, "unreachable.yaml");
    await writeFile(file, stringify(payload));

    const result = runValidate(file);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("is not reachable from $START");
  });

  test("E.6 $SUSPEND used as edge target exits 1", async () => {
    const payload = makeMinimalPayload("bad-suspend") as Record<string, unknown>;
    const graph = payload.graph as Record<string, Record<string, unknown>>;
    graph.writer = { done: { role: "$SUSPEND", prompt: "x", location: null } };

    const file = join(tmpDir, "bad-suspend.yaml");
    await writeFile(file, stringify(payload));

    const result = runValidate(file);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("$SUSPEND");
  });

  test("E.7 multiple semantic errors are all reported", async () => {
    const payload = makeMinimalPayload("multi-error") as Record<string, unknown>;
    // 1) unknown role: graph node referencing undefined role
    const graph = payload.graph as Record<string, Record<string, unknown>>;
    graph.bogus = { done: { role: "$END", prompt: "x", location: null } };
    // 2) $START missing resume
    graph.$START = {
      new: { role: "writer", prompt: "Begin", location: null },
    };
    // 3) bad mustache variable
    graph.writer = {
      done: { role: "$END", prompt: "Use {{ missing }}", location: null },
    };

    const file = join(tmpDir, "multi-error.yaml");
    await writeFile(file, stringify(payload));

    const result = runValidate(file);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("workflow validation failed:");
    expect(result.stderr).toContain('unknown role "bogus"');
    expect(result.stderr).toContain("$START must have edges");
    expect(result.stderr).toContain("missing");
    // each error is bullet-prefixed with `  - `
    expect(result.stderr).toContain("  - ");
  });
});

// ── Suite F: Isolation From CAS / Store ──────────────────────────────────────

describe("workflow validate — Suite F: Isolation From CAS / Store", () => {
  test("F.1 runs without OCAS_HOME set", async () => {
    const file = join(tmpDir, "iso-wf.yaml");
    await writeFile(file, stringify(makeMinimalPayload("iso-wf")));

    // Strip OCAS_HOME / UWF_HOME from env, point HOME at empty tmp.
    const isolatedHome = join(tmpDir, "isolated-home");
    await mkdir(isolatedHome, { recursive: true });
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.OCAS_HOME;
    delete env.UWF_HOME;
    env.HOME = isolatedHome;

    const result = runValidate(file, [], env);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("F.2 runs even when HOME is read-only (skip on win32)", {
    skip: process.platform === "win32",
  }, async () => {
    const file = join(tmpDir, "ro-home-wf.yaml");
    await writeFile(file, stringify(makeMinimalPayload("ro-home-wf")));

    const ro = join(tmpDir, "ro-home");
    await mkdir(ro, { recursive: true });
    await chmod(ro, 0o500); // r-x------

    try {
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.OCAS_HOME;
      delete env.UWF_HOME;
      env.HOME = ro;

      const result = runValidate(file, [], env);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    } finally {
      // restore permissions so afterEach can clean up
      await chmod(ro, 0o755);
    }
  });

  test("F.3 does not modify registry on success", async () => {
    const file = join(tmpDir, "reg-wf.yaml");
    await writeFile(file, stringify(makeMinimalPayload("reg-wf")));

    const ocasHome = join(tmpDir, "ocas-home");
    await mkdir(ocasHome, { recursive: true });
    const env: NodeJS.ProcessEnv = { ...process.env, OCAS_HOME: ocasHome, UWF_HOME: ocasHome };

    const beforeListing = await listingSnapshot(ocasHome);

    const result = runValidate(file, [], env);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");

    const afterListing = await listingSnapshot(ocasHome);
    expect(afterListing).toEqual(beforeListing);
  });

  test("F.4 does not write any nodes to CAS on success", async () => {
    const file = join(tmpDir, "cas-iso-wf.yaml");
    await writeFile(file, stringify(makeMinimalPayload("cas-iso-wf")));

    const ocasHome = join(tmpDir, "ocas2");
    await mkdir(ocasHome, { recursive: true });
    const env: NodeJS.ProcessEnv = { ...process.env, OCAS_HOME: ocasHome, UWF_HOME: ocasHome };

    const beforeListing = await listingSnapshot(ocasHome);

    const result = runValidate(file, [], env);
    expect(result.exitCode).toBe(0);

    const afterListing = await listingSnapshot(ocasHome);
    expect(afterListing).toEqual(beforeListing);
  });
});

// ── Suite G: Argument Surface ────────────────────────────────────────────────

describe("workflow validate — Suite G: Argument Surface", () => {
  test("G.1 missing <file> argument fails with non-zero exit", () => {
    const result = runCli(["workflow", "validate"]);

    expect(result.exitCode).not.toBe(0);
    // commander phrasing varies; check for the broad `missing required argument` string.
    expect(result.stderr.toLowerCase()).toContain("missing required argument");
  });

  test("G.2 'workflow --help' lists 'validate'", () => {
    const result = runCli(["workflow", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("validate");
  });

  test("G.3 'workflow validate --help' describes the command", () => {
    const result = runCli(["workflow", "validate", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("file");
    expect(result.stdout.length).toBeGreaterThan(0);
  });
});

// ── helpers for snapshot ─────────────────────────────────────────────────────

/**
 * Recursively snapshot a directory's listing (paths + sizes).
 * Used to assert no files are written during validate.
 */
async function listingSnapshot(root: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  async function walk(dir: string): Promise<void> {
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st: Awaited<ReturnType<typeof stat>>;
      try {
        st = await stat(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        await walk(full);
      } else {
        out[full.slice(root.length)] = st.size;
      }
    }
  }
  await walk(root);
  return out;
}

// Suppress unused warnings in tests that don't currently use these helpers
void readFile;
