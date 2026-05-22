import type { RoleDefinition } from "@uncaged/workflow-protocol";

/**
 * Build the role prompt from a RoleDefinition.
 *
 * Assembles structured sections: Goal, Capabilities, Procedure, Output.
 * Empty strings and empty arrays are omitted from the output.
 */
export function buildRolePrompt(role: RoleDefinition): string {
  const sections: string[] = [];

  if (role.goal !== "") {
    sections.push(`## Goal\n\n${role.goal}`);
  }

  if (role.capabilities.length > 0) {
    const list = role.capabilities.map((c) => `- ${c}`).join("\n");
    sections.push(`## Capabilities\n\n${list}`);
  }

  if (role.procedure !== "") {
    sections.push(`## Procedure\n\n${role.procedure}`);
  }

  if (role.output !== "") {
    sections.push(`## Output\n\n${role.output}`);
  }

  return sections.join("\n\n");
}
