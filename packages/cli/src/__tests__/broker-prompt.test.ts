/**
 * Unit tests for `assembleBrokerPrompt` (#387).
 *
 * Verifies the broker path assembles the same five-part prompt the legacy
 * spawned-agent path produced: output-format instruction, thread progress,
 * role prompt (goal/procedure/output), task prompt, and the
 * continuation/edge-prompt context (branching on first visit vs re-entry).
 */

import type { CasRef, StepContext, ThreadId, WorkflowPayload } from "@united-workforce/protocol";
import { describe, expect, test } from "vitest";
import { assembleBrokerPrompt } from "../commands/broker-step.js";

const THREAD_ID = "06FCBROKERPROMPTTEST000001" as ThreadId;

const OUTPUT_FORMAT_INSTRUCTION = "## Deliverable Format\n\nemit YAML frontmatter";

function buildWorkflow(): WorkflowPayload {
  return {
    version: 1,
    name: "review-flow",
    description: "two-role review flow",
    roles: {
      developer: {
        description: "writes code",
        goal: "implement the requested behavior",
        capabilities: ["coding"],
        procedure: "follow the spec and write tests",
        output: "a patch plus a short summary",
        frontmatter: "schema_developer" as CasRef,
      },
      reviewer: {
        description: "reviews code",
        goal: "review the implementation",
        capabilities: [],
        procedure: "check the diff carefully",
        output: "approve or reject",
        frontmatter: "schema_reviewer" as CasRef,
      },
    },
    graph: {},
  };
}

function stepContext(role: string, content: string | null, output: unknown): StepContext {
  return {
    role,
    output,
    detail: "detail_ref" as CasRef,
    agent: "test-agent",
    edgePrompt: "",
    startedAtMs: 0,
    completedAtMs: 1,
    cwd: "",
    assembledPrompt: null,
    usage: null,
    previousAttempts: null,
    content,
  };
}

describe("assembleBrokerPrompt", () => {
  test("first visit with no prior steps embeds role prompt, task, and edge prompt", () => {
    const prompt = assembleBrokerPrompt({
      workflow: buildWorkflow(),
      role: "developer",
      threadId: THREAD_ID,
      startPrompt: "Build the login form",
      steps: [],
      edgePrompt: "Implement the behavior defined in the spec files",
      outputFormatInstruction: OUTPUT_FORMAT_INSTRUCTION,
    });

    // 1. output-format instruction
    expect(prompt).toContain("## Deliverable Format");
    // 2. thread progress
    expect(prompt).toContain("## Thread Progress");
    expect(prompt).toContain("This is the first step of the thread");
    // 3. role prompt (goal + procedure + output)
    expect(prompt).toContain("## Goal");
    expect(prompt).toContain("implement the requested behavior");
    expect(prompt).toContain("## Procedure");
    expect(prompt).toContain("follow the spec and write tests");
    expect(prompt).toContain("## Output");
    expect(prompt).toContain("a patch plus a short summary");
    // 4. task prompt
    expect(prompt).toContain("## Task");
    expect(prompt).toContain("Build the login form");
    // 5. edge prompt (no prior steps → "Current Instruction")
    expect(prompt).toContain("## Current Instruction");
    expect(prompt).toContain("Implement the behavior defined in the spec files");
  });

  test("first visit with prior steps includes step content as continuation context", () => {
    const steps: StepContext[] = [
      stepContext("planner", "Here is the detailed plan for the feature.", { $status: "done" }),
    ];

    const prompt = assembleBrokerPrompt({
      workflow: buildWorkflow(),
      role: "developer",
      threadId: THREAD_ID,
      startPrompt: "Build the login form",
      steps,
      edgePrompt: "Implement the plan",
      outputFormatInstruction: OUTPUT_FORMAT_INSTRUCTION,
    });

    // Developer has not spoken yet → first visit, prior steps shown WITH content.
    expect(prompt).toContain("## What Happened Since Your Last Turn");
    expect(prompt).toContain("Here is the detailed plan for the feature.");
    expect(prompt).toContain("## Moderator Instruction");
    expect(prompt).toContain("Implement the plan");
    // Thread progress reflects the prior step.
    expect(prompt).toContain("Thread step 2");
  });

  test("re-entry shows only steps since last visit (meta-only continuation)", () => {
    const steps: StepContext[] = [
      stepContext("developer", "My first implementation attempt.", { $status: "done" }),
      stepContext("reviewer", "Please fix the validation logic.", { $status: "reject" }),
    ];

    const prompt = assembleBrokerPrompt({
      workflow: buildWorkflow(),
      role: "developer",
      threadId: THREAD_ID,
      startPrompt: "Build the login form",
      steps,
      edgePrompt: "Address the reviewer feedback",
      outputFormatInstruction: OUTPUT_FORMAT_INSTRUCTION,
    });

    // Re-entry: continuation lists the reviewer step since the last developer turn.
    expect(prompt).toContain("## What Happened Since Your Last Turn");
    expect(prompt).toContain("reviewer");
    expect(prompt).toContain("## Moderator Instruction");
    expect(prompt).toContain("Address the reviewer feedback");
    // Meta-only re-entry omits raw step content from before the last visit.
    expect(prompt).not.toContain("My first implementation attempt.");
  });
});
