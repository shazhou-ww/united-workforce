/**
 * Build a minimal prompt for retrying frontmatter output on a resumed session.
 *
 * Used when a previous run completed successfully but frontmatter validation
 * failed — the session already has full context, we just need the agent to
 * re-output correctly formatted frontmatter without redoing any work.
 */
export function buildFrontmatterRetryPrompt(outputFormatInstruction: string): string {
  const parts: string[] = [
    "Your previous run completed all work successfully, but the output format was incorrect.",
    "You do NOT need to redo any work — all changes are already in place.",
    "",
  ];
  if (outputFormatInstruction !== "") {
    parts.push(outputFormatInstruction, "");
  }
  parts.push(
    "Please output ONLY the corrected YAML frontmatter block (--- delimited) followed by a brief summary of the work you completed.",
  );
  return parts.join("\n");
}
