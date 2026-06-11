import { execFileSync } from "node:child_process";

/**
 * A single step entry as exposed by `uwf step list --format raw-json` under 0.6.
 *
 * Richer per-step data (frontmatter, turns, agent, usage) lives in the step
 * detail node and is fetched separately via `readStepDetail(hash)` when needed.
 */
export type StepListEntry = {
  hash: string;
  role: string;
  durationMs: number | null;
};

type StepListPayload = {
  threadId: string;
  items: StepListEntry[];
};

/** Shell out to `uwf step list --format raw-json` and return the bare-value payload's items. */
export function readThreadSteps(threadId: string): StepListEntry[] {
  const stdout = execFileSync("uwf", ["--format", "raw-json", "step", "list", threadId], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const parsed = JSON.parse(stdout) as StepListPayload;
  // The 0.6 payload does not include a synthetic start entry — every item is a real step.
  return parsed.items;
}

/**
 * Per-step detail surface used by builtin judges. Mirrors the
 * `StepDetailPayload` schema (`@uwf/output/step-detail`) but only exposes the
 * fields judges currently consume.
 */
export type StepDetail = {
  hash: string;
  role: string;
  agent: string;
  durationMs: number | null;
  frontmatter: Record<string, unknown>;
  usage: {
    turns: number;
    inputTokens: number;
    outputTokens: number;
    duration: number;
  } | null;
};

type StepDetailRawPayload = {
  hash: string;
  role: string;
  agent: string;
  durationMs: number | null;
  frontmatter: Record<string, unknown>;
  // Usage is not exposed by the @uwf/output/step-detail schema yet; judges fall
  // back to zeros when the field is null. Kept on the type for forward compat.
  usage: {
    turns: number;
    inputTokens: number;
    outputTokens: number;
    duration: number;
  } | null;
};

/**
 * Shell out to `uwf step show <hash> --format raw-json` and return the bare-value
 * step-detail payload. Used by judges that need richer per-step data than
 * `readThreadSteps` exposes (e.g. frontmatter contents, token usage).
 */
export function readStepDetail(stepHash: string): StepDetail {
  const stdout = execFileSync("uwf", ["--format", "raw-json", "step", "show", stepHash], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const parsed = JSON.parse(stdout) as StepDetailRawPayload;
  return {
    hash: parsed.hash,
    role: parsed.role,
    agent: parsed.agent,
    durationMs: parsed.durationMs,
    frontmatter:
      parsed.frontmatter !== null &&
      typeof parsed.frontmatter === "object" &&
      !Array.isArray(parsed.frontmatter)
        ? parsed.frontmatter
        : {},
    usage: parsed.usage,
  };
}
