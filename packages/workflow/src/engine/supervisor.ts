import { resolveModel } from "../config/index.js";
import type { WorkflowConfig } from "../registry/index.js";
import { err, type LogFn, ok, type Result } from "../util/index.js";

import type { SupervisorDecision } from "./types.js";

const SUPERVISOR_RECENT_STEP_LIMIT = 12;

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/chat/completions`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readAssistantContent(parsed: unknown): string | null {
  if (!isRecord(parsed)) {
    return null;
  }
  const choices = parsed.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const first = choices[0];
  if (!isRecord(first)) {
    return null;
  }
  const messageObj = first.message;
  if (!isRecord(messageObj)) {
    return null;
  }
  const content = messageObj.content;
  if (typeof content !== "string") {
    return null;
  }
  return content;
}

/** Lenient: accepts STOP/stop/stop. as prose; prefers {@link SupervisorDecision.stop} when both tokens appear. */
export function parseSupervisorDecisionText(text: string): SupervisorDecision {
  const lower = text.toLowerCase();
  const stopWord = /\bstop\b/.test(lower);
  const continueWord = /\bcontinue\b/.test(lower);
  if (stopWord && continueWord) {
    const si = lower.search(/\bstop\b/);
    const ci = lower.search(/\bcontinue\b/);
    return si <= ci ? "stop" : "continue";
  }
  if (stopWord) {
    return "stop";
  }
  if (continueWord) {
    return "continue";
  }
  if (lower.includes("stop")) {
    return "stop";
  }
  if (lower.includes("continue")) {
    return "continue";
  }
  return "continue";
}

type RunSupervisorArgs = {
  config: WorkflowConfig;
  prompt: string;
  recentSteps: readonly { role: string; summary: string }[];
  logger: LogFn;
};

/** Calls the `supervisor` scene LLM; opt-out when {@link resolveModel} fails (returns ok(`continue`)). */
export async function runSupervisor(
  args: RunSupervisorArgs,
): Promise<Result<SupervisorDecision, string>> {
  const resolved = resolveModel(args.config, "supervisor");
  if (!resolved.ok) {
    return ok("continue");
  }
  const provider = resolved.value;
  const recent = args.recentSteps.slice(-SUPERVISOR_RECENT_STEP_LIMIT);
  const stepsBlock = recent.map((s, index) => `${index + 1}. [${s.role}] ${s.summary}`).join("\n");

  const body = {
    model: provider.model,
    messages: [
      {
        role: "system" as const,
        content:
          'You supervise a multi-step workflow. Decide if the thread should keep running or halt.\n\nReply with exactly one token: either "continue" (progress toward the goal, not obviously stuck) or "stop" (done, looping, or no progress). Do not add explanation.',
      },
      {
        role: "user" as const,
        content: `Original task:\n${args.prompt}\n\nRecent steps (oldest first):\n${stepsBlock === "" ? "(none)" : stepsBlock}`,
      },
    ],
  };

  let response: Response;
  try {
    response = await fetch(chatCompletionsUrl(provider.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    args.logger("R9CW4PLM", `supervisor request failed: ${message}`);
    return err(`supervisor network error: ${message}`);
  }

  const responseText = await response.text();
  if (!response.ok) {
    args.logger("T3HN8VKQ", `supervisor HTTP ${response.status}: ${responseText.slice(0, 200)}`);
    return err(`supervisor HTTP ${response.status}: ${responseText.slice(0, 500)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText) as unknown;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    args.logger("W7BQ2NXM", `supervisor response is not JSON: ${message}`);
    return err(`supervisor invalid JSON: ${message}`);
  }

  const content = readAssistantContent(parsed);
  if (content === null || content.trim() === "") {
    args.logger("Y4JX9PKW", "supervisor returned empty assistant content");
    return err("supervisor empty assistant content");
  }

  const decision = parseSupervisorDecisionText(content);
  args.logger("Z8KM5QWT", `supervisor says ${decision}`);
  return ok(decision);
}
