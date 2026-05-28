/**
 * Frontmatter Markdown — agent output format.
 *
 * An agent response is a Markdown document with an optional YAML frontmatter
 * block at the top.  The frontmatter carries structured signals that the
 * moderator and engine can consume without running a full LLM extract pass.
 *
 * Wire format:
 *
 *   ---
 *   status: done
 *   ---
 *
 *   ... free-form markdown body ...
 *
 * Only `status` is a standard frontmatter field.  All other fields are
 * role-specific and defined by the output schema.
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

// ── Core frontmatter schema ──────────────────────────────────────────────────

/**
 * Parsed and validated frontmatter from an agent response.
 *
 * Only `status` is a standard field.  All other fields are role-specific.
 */
export type AgentFrontmatter = {
  /**
   * Completion status signal from the agent.
   * Null when omitted — engine treats it as "done" for backward compatibility.
   */
  status: FrontmatterStatus | null;
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

export type FrontmatterValidationError = { field: "status"; message: string };
