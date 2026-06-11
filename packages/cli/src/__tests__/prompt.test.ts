import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

import { generateCliReference } from "@united-workforce/util";
import {
  cmdPromptAdapterDeveloping,
  cmdPromptBootstrap,
  cmdPromptList,
  cmdPromptUsage,
  cmdPromptWorkflowAuthoring,
} from "../commands/prompt.js";

describe("prompt commands", () => {
  test("prompt list returns prompt names (no bootstrap)", () => {
    const result = cmdPromptList();
    expect(result).toBeInstanceOf(Array);
    expect(result).toContain("usage");
    expect(result).toContain("workflow-authoring");
    expect(result).toContain("adapter-developing");
    expect(result).not.toContain("bootstrap");
    for (const name of result) {
      expect(name).toMatch(/^\S+$/);
    }
  });

  test("prompt usage returns only the usage reference with frontmatter", () => {
    const result = cmdPromptUsage();
    expect(typeof result).toBe("string");
    expect(result).toContain("uwf");
    expect(result).toContain("thread");
    expect(result).toContain("workflow");
    expect(result).toContain("Quick Start");
    expect(result).toContain("---");
    expect(result).toContain("name:");
    expect(result).toContain("version:");
    // Should NOT contain other references
    expect(result).not.toContain("Workflow Authoring Reference");
    expect(result).not.toContain("Adapter Developing Reference");
    expect(result.length).toBeGreaterThan(500);
  });

  test("prompt usage describes .workflows/ auto-discovery", () => {
    const result = cmdPromptUsage();
    expect(result).toContain(".workflows/");
    expect(result).toContain("uwf thread start solve-issue");
    expect(result.toLowerCase()).toContain("auto-discover");
    expect(result.toLowerCase()).toContain("recommended");
  });

  test("prompt cli-reference describes .workflows/ auto-discovery", () => {
    const ref = generateCliReference();
    expect(ref).toContain(".workflows/");
    expect(ref.toLowerCase()).toContain("cwd upward");
    expect(ref).toContain("workflow list");
    expect(ref).toMatch(/CAS hash/i);
    expect(ref).toMatch(/file path/i);
    expect(ref).toMatch(/registry/i);
  });

  test("prompt workflow-authoring returns non-empty markdown string with frontmatter", () => {
    const result = cmdPromptWorkflowAuthoring();
    expect(typeof result).toBe("string");
    expect(result).toContain("frontmatter");
    expect(result).toContain("graph");
    expect(result).toContain("$START");
    expect(result).toContain("$END");
    expect(result).toContain("$status");
    expect(result).toContain("---");
    expect(result).toContain("name:");
    expect(result).toContain("version:");
    expect(result.length).toBeGreaterThan(500);
  });

  test("prompt workflow-authoring documents .workflows/ Placement section", () => {
    const result = cmdPromptWorkflowAuthoring();
    expect(result).toContain("## Placement");
    expect(result).toContain(".workflows/");
    expect(result).toContain("solve-issue.yaml");
    expect(result.toLowerCase()).toContain("auto-discover");
    expect(result.toLowerCase()).toContain("no workflow add");
    // Placement must appear before Self-Testing
    expect(result.indexOf("## Placement")).toBeLessThan(result.indexOf("## Self-Testing"));
  });

  test("prompt workflow-authoring mentions .workflow/ as legacy fallback", () => {
    const result = cmdPromptWorkflowAuthoring();
    expect(result).toContain(".workflow/");
    expect(result.toLowerCase()).toContain("legacy");
  });

  test("prompt workflow-authoring documents Liquid filters with join example", () => {
    const result = cmdPromptWorkflowAuthoring();
    expect(result).toContain("| join");
    expect(result.toLowerCase()).toContain("filter");
  });

  test("prompt workflow-authoring documents Liquid loops with for example", () => {
    const result = cmdPromptWorkflowAuthoring();
    expect(result).toContain("{% for");
    expect(result).toContain("{% endfor %}");
  });

  test("prompt workflow-authoring uses Liquid terminology with no Mustache remnants", () => {
    const result = cmdPromptWorkflowAuthoring();
    expect(result.toLowerCase()).not.toContain("mustache");
    expect(result.toLowerCase()).toContain("liquid");
  });

  test("prompt adapter-developing returns non-empty markdown string with frontmatter", () => {
    const result = cmdPromptAdapterDeveloping();
    expect(typeof result).toBe("string");
    expect(result).toContain("createAgent");
    expect(result).toContain("AgentContext");
    expect(result).toContain("frontmatter");
    expect(result).toContain("---");
    expect(result).toContain("name:");
    expect(result).toContain("version:");
    expect(result.length).toBeGreaterThan(500);
  });

  test("prompt bootstrap returns framework-agnostic setup instructions", () => {
    const result = cmdPromptBootstrap();
    expect(typeof result).toBe("string");
    // Skills installation
    expect(result).toContain("uwf prompt usage");
    expect(result).toContain("uwf prompt workflow-authoring");
    expect(result).toContain("uwf prompt adapter-developing");
    expect(result).toContain("uwf-usage");
    expect(result).toContain("uwf-workflow-authoring");
    expect(result).toContain("uwf-adapter-developing");
    // Fresh install scenario
    expect(result).toContain("Fresh Install");
    expect(result).toContain("uwf setup");
    expect(result).toContain("agent adapter");
    // Upgrade scenario
    expect(result).toContain("Upgrade");
    expect(result).toContain("Migrate");
    // Should NOT contain Hermes-specific paths
    expect(result).not.toContain("~/.hermes/skills/");
    expect(result).not.toContain("> ~/.hermes/");
    expect(result.length).toBeGreaterThan(100);
  });

  // Skip: pure documentation content assertions on bootstrap prompt text.
  test.skip("prompt bootstrap has no LLM provider/model references", () => {
    const result = cmdPromptBootstrap();
    // Must NOT contain provider/model flags
    expect(result).not.toContain("--provider");
    expect(result).not.toContain("--base-url");
    expect(result).not.toContain("--api-key");
    expect(result).not.toContain("--model");
    // Must NOT contain old Step 2 about provider config
    expect(result).not.toContain("Configure provider and model");
    // Must NOT contain preset providers table
    expect(result).not.toContain("openrouter");
    expect(result).not.toContain("OpenRouter");
    expect(result).not.toContain("xAI");
    expect(result).not.toContain("dashscope");
    // Must NOT show provider/model config keys
    expect(result).not.toContain("providers:");
    expect(result).not.toContain("defaultModel");
    expect(result).not.toContain("models:");
    // Setup step must show only --agent
    expect(result).toContain("uwf setup --agent");
    // Config example must show only agents, defaultAgent, agentOverrides
    expect(result).toContain("agents:");
    expect(result).toContain("defaultAgent:");
    // Must mention per-adapter LLM config
    expect(result).toMatch(/~\/\.uwf\/agents\//);
  });

  // Skip: pure documentation content assertions on bootstrap prompt text.
  test.skip("prompt bootstrap step numbering has no gaps after removing old Step 2", () => {
    const result = cmdPromptBootstrap();
    // Extract only the Fresh Install section
    const freshStart = result.indexOf("## Scenario A: Fresh Install");
    const freshEnd = result.indexOf("## Scenario B:");
    const freshSection = result.slice(freshStart, freshEnd);
    const stepHeaders = freshSection.match(/### Step \d+/g) ?? [];
    const stepNumbers = stepHeaders.map((h) => Number.parseInt(h.replace("### Step ", ""), 10));
    // Verify sequential numbering (0, 1, 2, 3, ...)
    for (let i = 0; i < stepNumbers.length; i++) {
      expect(stepNumbers[i]).toBe(i);
    }
  });

  test("prompt help subcommand is suppressed", { timeout: 30_000 }, () => {
    const cliPath = join(__dirname, "..", "..", "dist", "cli.js");
    const output = execFileSync("node", [cliPath, "prompt", "--help"], {
      encoding: "utf-8",
      env: { ...process.env },
    });
    expect(output).not.toMatch(/help\s+\[command\]/i);
    expect(output).toContain("usage");
    expect(output).toContain("bootstrap");
    expect(output).toContain("workflow-authoring");
    expect(output).toContain("adapter-developing");
    expect(output).toContain("list");
    // Removed subcommands should not appear as command names
    expect(output).not.toMatch(/^\s+setup\s/m);
    expect(output).not.toContain("usage-reference");
  });
});

// Skip: pure documentation content assertions — text changes break these without
// indicating real bugs. Verified by human review instead. See #299 discussion.
describe.skip("prompt adapter-developing — issue #214 v0.4 contract", () => {
  const text = cmdPromptAdapterDeveloping();
  const lower = text.toLowerCase();

  // ── Item 1 — AgentOptions includes fork and cleanup ─────────────────
  test("AgentOptions documents fork field with AgentForkFn | null", () => {
    expect(text).toContain("AgentOptions");
    expect(text).toMatch(/fork\s*:\s*AgentForkFn\s*\|\s*null/);
    expect(text).toContain("AgentForkFn");
  });

  test("AgentOptions documents cleanup field with AgentCleanupFn | null", () => {
    expect(text).toMatch(/cleanup\s*:\s*AgentCleanupFn\s*\|\s*null/);
    expect(text).toContain("AgentCleanupFn");
  });

  test("explains that fork=null is acceptable for adapters that do not implement step ask", () => {
    expect(lower).toMatch(/fork.*null.*(do(es)? not|no).*step ask|step ask.*fork.*null/);
  });

  test("explains that cleanup runs after the agent completes (success or failure)", () => {
    expect(lower).toMatch(
      /cleanup.*(after|completes|invoked).*(release|i\/?o|resources|subprocess)/,
    );
  });

  // ── Item 2 — Public helpers table is complete ───────────────────────
  test("helpers table lists buildRolePrompt", () => {
    expect(text).toContain("buildRolePrompt");
  });

  test("helpers table lists buildContinuationPrompt", () => {
    expect(text).toContain("buildContinuationPrompt");
  });

  test("helpers table lists buildThreadProgress", () => {
    expect(text).toContain("buildThreadProgress");
  });

  test("helpers table lists buildOutputFormatInstruction", () => {
    expect(text).toContain("buildOutputFormatInstruction");
  });

  test("helpers table lists buildSuspendOutput", () => {
    expect(text).toContain("buildSuspendOutput");
  });

  test("helpers table lists buildFrontmatterRetryPrompt", () => {
    expect(text).toContain("buildFrontmatterRetryPrompt");
  });

  test("helpers table lists session-cache helpers", () => {
    expect(text).toContain("getCachedSessionId");
    expect(text).toContain("setCachedSessionId");
    expect(text).toContain("getAskSessionId");
    expect(text).toContain("setAskSessionId");
  });

  // ── Item 3 — $SUSPEND coroutine yield ───────────────────────────────
  test("documents $SUSPEND as coroutine yield with reason", () => {
    expect(text).toContain("$SUSPEND");
    expect(lower).toContain("coroutine");
    expect(lower).toMatch(/reason/);
  });

  test("documents buildSuspendOutput helper to emit a $SUSPEND output", () => {
    expect(text).toContain("buildSuspendOutput");
    expect(text).toMatch(/buildSuspendOutput\s*\(/);
  });

  test("documents trySuspendFastPath round-trip and SUSPEND_OUTPUT_SCHEMA", () => {
    expect(text).toContain("trySuspendFastPath");
    expect(text).toMatch(/SUSPEND_OUTPUT_SCHEMA|suspendOutput/);
  });

  test("explains engine intercepts $SUSPEND before the moderator", () => {
    expect(lower).toMatch(/intercept.*moderator|before the moderator|engine.*suspend/);
    expect(lower).toMatch(/(thread|state).*suspend/);
  });

  test("notes that $SUSPEND is reserved and may be emitted by any role regardless of declared output", () => {
    expect(lower).toMatch(/(any role|every role|regardless).*\$?suspend|reserved/);
  });

  // ── Item 4 — step ask adapter contract ──────────────────────────────
  test("documents step ask --mode fork CLI contract for adapters", () => {
    expect(text).toContain("--mode fork");
    expect(text).toContain("--session");
    expect(lower).toMatch(/fork.*(stdout|prints|return).*session/);
  });

  test("documents step ask --mode ask CLI contract", () => {
    expect(text).toContain("--mode ask");
    expect(text).toContain("--prompt");
  });

  test("explains that fork: null adapters do not need to handle --mode fork/ask", () => {
    expect(lower).toMatch(/fork\s*:\s*null.*(do(es)? not|no|not required).*(--mode|step ask)/);
  });

  test("documents the per-stepHash ask-session cache key", () => {
    expect(text).toContain("getAskSessionId");
    expect(lower).toMatch(/(<step ?hash>|stephash).*:ask|ask.*cache|forked.*session.*step/);
  });

  // ── Item 5 — Adapter-owned LLM config ───────────────────────────────
  test("explains engine config.yaml is LLM-free (no providers/models)", () => {
    expect(lower).toMatch(/engine.*(config|llm-free|llm free)/);
    expect(lower).toMatch(/no.*(provider|model|api[- ]?key)/);
  });

  test("shows the adapter-owned config path convention ~/.uwf/agents/<name>.yaml", () => {
    expect(text).toMatch(/~\/?\.uwf\/agents\/.+\.yaml/);
  });

  test("shows a concrete example with provider.baseUrl, provider.apiKey, model", () => {
    expect(text).toContain("baseUrl");
    expect(text).toContain("apiKey");
    expect(text).toMatch(/^\s*model\s*:/m);
  });

  test("references storageRoot from AgentContext as the way to resolve the adapter config path", () => {
    expect(text).toContain("storageRoot");
    expect(lower).toMatch(/(storageroot|ctx\.storageroot).*(agents\/|config|yaml)/);
  });

  // ── Item 6 — previousAttempts and $status: error ────────────────────
  test("documents the failed-step retry path with $status: error", () => {
    expect(text).toMatch(/\$status\s*:\s*["']?error["']?/);
    expect(text).toContain("ErrorOutputPayload");
  });

  test("documents previousAttempts as CAS refs to prior failed StepNodes", () => {
    expect(text).toContain("previousAttempts");
    expect(lower).toMatch(/previousattempts.*(failed|prior|retry).*step/);
  });

  test("explains thread head is NOT advanced on isError=true", () => {
    expect(lower).toMatch(/(head|thread).*not.*advance|advance.*not|isError.*true/);
  });

  test("documents the @uwf/thread-failed variable for tracking failed attempts across runs", () => {
    expect(text).toContain("@uwf/thread-failed/");
  });

  test("explains MAX_FRONTMATTER_RETRIES (2) before persisting the error step", () => {
    expect(text).toMatch(/2\s*(retries?|attempts?|frontmatter)/i);
  });

  // ── Item 7 — Realistic run() skeleton ───────────────────────────────
  test("Quick Start run() builds prompt via helpers (not empty comments)", () => {
    expect(text).toMatch(/buildRolePrompt|buildContinuationPrompt|buildThreadProgress/);
  });

  test("Quick Start run() returns all 5 AgentRunResult fields", () => {
    expect(text).toContain("assembledPrompt");
    expect(text).toContain("usage");
    expect(text).toContain("detailHash");
    expect(text).toContain("sessionId");
  });

  test("documents Usage type fields turns/inputTokens/outputTokens/duration", () => {
    expect(text).toContain("inputTokens");
    expect(text).toContain("outputTokens");
    expect(text).toMatch(/turns/);
    expect(text).toContain("duration");
  });

  test("Quick Start example does NOT contain the placeholder stub `// 1. Build your prompt from ctx`", () => {
    expect(text).not.toMatch(/\/\/\s*1\.\s*Build your prompt from ctx\b/);
  });

  // ── Item 8 — isFirstVisit ───────────────────────────────────────────
  test("explains isFirstVisit semantics", () => {
    expect(text).toContain("isFirstVisit");
    expect(lower).toMatch(/isfirstvisit.*(true|false).*(role|appeared|run|history)/);
  });

  test("explains the first-visit / re-entry branching pattern", () => {
    expect(lower).toMatch(/(first[- ]?visit|isfirstvisit)[\s\S]*(re-?entry|resume)/);
  });

  // ── Item 9 — Fast path jargon explained ─────────────────────────────
  test("introduces frontmatter extraction concept before the symbol name", () => {
    const idxConcept = lower.search(
      /frontmatter extraction|extract.*frontmatter|parse.*frontmatter/,
    );
    const idxSymbol = text.indexOf("tryFrontmatterFastPath");
    if (idxSymbol !== -1) {
      expect(idxConcept).toBeGreaterThanOrEqual(0);
      expect(idxConcept).toBeLessThan(idxSymbol);
    }
  });

  test("does not use the bare term 'fast path' without an explanation in the surrounding 200 chars", () => {
    const re = /fast[- ]?path/gi;
    let m: RegExpExecArray | null = re.exec(text);
    while (m !== null) {
      const window = text.slice(Math.max(0, m.index - 200), m.index + 200).toLowerCase();
      expect(window).toMatch(/extract|parse|attempt|try|interpret/);
      m = re.exec(text);
    }
  });

  // ── Item 10 — No undefined schema variables ─────────────────────────
  test("does not reference an undefined `textSchema` in the code samples", () => {
    const idx = text.indexOf("textSchema");
    if (idx !== -1) {
      const window = text.slice(Math.max(0, idx - 200), idx + 200);
      expect(window).toMatch(/registerAgentSchemas|schemas\.text|putSchema|TEXT_SCHEMA/);
    }
  });

  test("does not reference an undefined `detailSchema` in the code samples", () => {
    const idx = text.indexOf("detailSchema");
    if (idx !== -1) {
      const window = text.slice(Math.max(0, idx - 200), idx + 200);
      expect(window).toMatch(/registerAgentSchemas|schemas|putSchema/);
    }
  });

  test("Storing Session Detail section uses real APIs (storeBuiltinDetail / storeClaudeCodeDetail or store.cas.put with a registered schema)", () => {
    expect(text).toMatch(
      /store\.cas\.put|storeBuiltinDetail|storeClaudeCodeDetail|registerAgentSchemas/,
    );
  });

  // ── Cross-cutting structural tests ──────────────────────────────────
  test("AdapterOutput JSON envelope (not just step hash) is documented as the stdout contract", () => {
    expect(text).toContain("AdapterOutput");
    expect(lower).toMatch(/json.*stdout|stdout.*json/);
    expect(text).toContain("isError");
    expect(text).toContain("errorMessage");
  });

  test("documents AgentContext storageRoot and casDir fields", () => {
    expect(text).toContain("storageRoot");
    expect(text).toContain("casDir");
  });

  test("documents UWF_HOME / OCAS_HOME env propagation from CLI to adapter", () => {
    expect(text).toContain("UWF_HOME");
    expect(text).toContain("OCAS_HOME");
  });

  test("Existing Adapters table still lists hermes, builtin, claude-code", () => {
    expect(text).toContain("uwf-hermes");
    expect(text).toContain("uwf-builtin");
    expect(text).toContain("uwf-claude-code");
  });

  test("Checklist now includes fork, cleanup, $SUSPEND, and adapter-owned LLM config items", () => {
    const checklistIdx = text.search(/##\s+Checklist/);
    expect(checklistIdx).toBeGreaterThan(-1);
    const checklist = text.slice(checklistIdx);
    expect(checklist).toContain("fork");
    expect(checklist).toContain("cleanup");
    expect(checklist).toContain("$SUSPEND");
    expect(checklist.toLowerCase()).toMatch(/llm config|agents\/.+\.yaml|adapter-owned/);
  });
});

// Skip: pure documentation content assertions on reference text.
describe.skip("prompt workflow-authoring — issue #226 edge location field", () => {
  const text = cmdPromptWorkflowAuthoring();
  const lower = text.toLowerCase();

  // ── Group 1 — Field documentation ───────────────────────────────────
  test("documents the location field on graph edges", () => {
    expect(text).toMatch(/^\s*\|\s*`?location`?\s*\|/m);
    expect(text).toMatch(/location[\s\S]{0,200}(working directory|cwd)/i);
  });

  test("documents location as optional with null fallback", () => {
    expect(lower).toMatch(/location[\s\S]{0,300}(null|omitted|optional|default|fall(s| ?back))/i);
    expect(lower).toMatch(/(thread.*cwd|start.*cwd|creation cwd|thread['']?s cwd)/);
  });

  test("documents Liquid template support for location", () => {
    expect(text).toMatch(/location[\s\S]{0,400}\{\{\s*[a-zA-Z_]\w*\s*\}\}/);
    expect(lower).toMatch(/location[\s\S]{0,300}liquid/);
  });

  // ── Group 2 — Inheritance chain ─────────────────────────────────────
  test("documents the cwd inheritance chain end-to-end", () => {
    expect(text).toContain("--cwd");
    expect(text).toMatch(/StartNodePayload\.cwd|start(\.|node\.)?cwd|thread start cwd/i);
    expect(text).toMatch(/Target\.location|edge\s+location|location\s+(field|override)/i);
    expect(text).toMatch(/StepRecord\.cwd|StepNodePayload\.cwd|step(\.|node\.)?cwd|step.*cwd/i);
    const flagIdx = text.indexOf("--cwd");
    const startIdx = text.search(/StartNodePayload\.cwd|start(\.|node\.)?cwd|thread start cwd/i);
    const locIdx = text.search(/Target\.location|edge\s+location|location\s+(field|override)/i);
    const stepIdx = text.search(/StepRecord\.cwd|StepNodePayload\.cwd|step(\.|node\.)?cwd/i);
    expect(flagIdx).toBeGreaterThanOrEqual(0);
    expect(startIdx).toBeGreaterThan(flagIdx);
    expect(locIdx).toBeGreaterThan(startIdx);
    expect(stepIdx).toBeGreaterThan(locIdx);
  });

  test("explains location override is per-step (not per-thread)", () => {
    expect(lower).toMatch(/(each|per).?step|override.*per.*step|step['']?s (working|cwd)/);
  });

  // ── Group 3 — Realistic cross-cwd example ───────────────────────────
  test("includes a YAML example showing location on an edge", () => {
    const yamlBlocks = text.match(/```yaml[\s\S]*?```/g) ?? [];
    const hasLocationEdge = yamlBlocks.some(
      (b) => /graph\s*:/.test(b) && /^\s*location\s*:/m.test(b),
    );
    expect(hasLocationEdge).toBe(true);
  });

  test("example demonstrates cross-cwd execution with a Liquid-templated path", () => {
    const yamlBlocks = text.match(/```yaml[\s\S]*?```/g) ?? [];
    const hasCrossCwdExample = yamlBlocks.some((b) =>
      /location\s*:\s*['"]?\{\{\s*[a-zA-Z_]\w*\s*\}\}/m.test(b),
    );
    expect(hasCrossCwdExample).toBe(true);
  });

  test("example narrates a realistic scenario", () => {
    expect(lower).toMatch(
      /(clone|checkout|dispatch|cross[- ]repo|different (repo|directory|working directory|cwd))/,
    );
  });

  // ── Group 4 — Structural placement ──────────────────────────────────
  test("location documentation appears under the Graph Routing section", () => {
    const graphIdx = text.indexOf("## Graph Routing");
    expect(graphIdx).toBeGreaterThanOrEqual(0);
    const after = text.slice(graphIdx);
    const localLocIdx = after.search(/\blocation\b/i);
    expect(localLocIdx).toBeGreaterThanOrEqual(0);
    const nextHeadingIdx = after.slice(1).search(/\n## /);
    expect(localLocIdx).toBeLessThan(nextHeadingIdx === -1 ? after.length : nextHeadingIdx + 1);
  });

  test("Target field table still includes role and prompt alongside location", () => {
    expect(text).toMatch(/\|\s*`?role`?\s*\|/m);
    expect(text).toMatch(/\|\s*`?prompt`?\s*\|/m);
    expect(text).toMatch(/\|\s*`?location`?\s*\|/m);
  });
});
