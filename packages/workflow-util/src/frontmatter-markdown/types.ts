/**
 * Frontmatter Markdown — agent output format (RFC #351 Phase 1).
 *
 * An agent response is a Markdown document with an optional YAML frontmatter
 * block at the top.  The frontmatter carries structured signals that the
 * moderator and engine can consume without running a full LLM extract pass.
 *
 * Wire format:
 *
 *   ---
 *   status: done
 *   next: reviewer
 *   confidence: 0.9
 *   artifacts:
 *     - src/foo.ts
 *   scope: role
 *   ---
 *
 *   ... free-form markdown body ...
 *
 * All frontmatter fields are optional at the parse level.  `validateFrontmatter`
 * enforces the constraints documented on each field below.
 */

// ── Vocabulary types ─────────────────────────────────────────────────────────

/**
 * High-level signal from the agent about where work stands.
 *
 * - `done`        — role completed its objective; moderator may advance
 * - `needs_input` — agent is blocked and requires human or peer clarification
 * - `in_progress` — work is underway but the agent chose to yield early
 * - `failed`      — agent cannot complete the task and explains why in the body
 */
export type FrontmatterStatus = "done" | "needs_input" | "in_progress" | "failed";

/**
 * Scope of frontmatter signals.
 *
 * - `role`   — signals apply to the current role execution only (default)
 * - `thread` — signals are suggestions for the entire thread moderator
 */
export type FrontmatterScope = "role" | "thread";

// ── Core frontmatter schema ──────────────────────────────────────────────────

/**
 * Parsed and validated frontmatter from an agent response.
 *
 * All fields use explicit `T | null` (no optional `?:` per convention).
 */
export type AgentFrontmatter = {
  /**
   * Completion status signal from the agent.
   * Null when omitted — engine treats it as "done" for backward compatibility.
   */
  status: FrontmatterStatus | null;

  /**
   * Suggested next role name for the moderator.
   * The moderator is NOT obligated to follow this — it is advisory only.
   * Null when the agent has no preference.
   */
  next: string | null;

  /**
   * Agent's self-assessed confidence in its output (0.0 – 1.0 inclusive).
   * Null when omitted.
   */
  confidence: number | null;

  /**
   * Relative file paths or CAS hashes the agent considers its primary outputs.
   * Used for GC ref-tracing and human-readable summaries.
   * Empty array when omitted (never null — an absent list is an empty list).
   */
  artifacts: readonly string[];

  /**
   * Scope of the frontmatter signals.
   * Defaults to "role" when omitted.
   */
  scope: FrontmatterScope;
};

// ── Parse output ─────────────────────────────────────────────────────────────

/**
 * Result of `parseFrontmatterMarkdown`: the structured frontmatter (if present)
 * and the body (everything after the closing `---` fence, or the whole input
 * if no frontmatter was found).
 */
export type ParsedFrontmatterMarkdown = {
  /**
   * Parsed frontmatter fields.  Null when no frontmatter block was detected
   * (i.e. the document does not start with `---`).
   */
  frontmatter: AgentFrontmatter | null;

  /** Markdown body with frontmatter block stripped. Leading newline removed. */
  body: string;
};

// ── Validation error ─────────────────────────────────────────────────────────

export type FrontmatterValidationError =
  | { field: "status"; message: string }
  | { field: "next"; message: string }
  | { field: "confidence"; message: string }
  | { field: "artifacts"; message: string }
  | { field: "scope"; message: string };
