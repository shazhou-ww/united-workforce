import type { RoleDefinition } from "@uncaged/workflow-protocol";

/**
 * Build the role prompt from a RoleDefinition.
 *
 * Four-phase mode (identity/prepare/execute/report present):
 *   Assembles structured sections for each phase.
 *
 * Legacy mode (only systemPrompt):
 *   Returns systemPrompt as-is.
 *
 * When both are present, four-phase fields take priority.
 */
export function buildRolePrompt(role: RoleDefinition): string {
  const hasFourPhase =
    role.identity !== null &&
    role.identity !== undefined &&
    role.identity !== "";

  if (!hasFourPhase) {
    return role.systemPrompt ?? "";
  }

  const sections: string[] = [];

  sections.push(`## Identity\n\n${role.identity}`);

  if (role.prepare !== null && role.prepare !== undefined && role.prepare !== "") {
    sections.push(`## Prepare\n\n${role.prepare}`);
  }

  if (role.execute !== null && role.execute !== undefined && role.execute !== "") {
    sections.push(`## Execute\n\n${role.execute}`);
  }

  if (role.report !== null && role.report !== undefined && role.report !== "") {
    sections.push(`## Report\n\n${role.report}`);
  }

  return sections.join("\n\n");
}
