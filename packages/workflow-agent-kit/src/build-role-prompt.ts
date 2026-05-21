import type { RoleDefinition } from "@uncaged/workflow-protocol";

/**
 * Build the role prompt from a RoleDefinition.
 *
 * Assembles structured sections: Identity, Prepare, Execute, Report.
 * Empty strings are omitted from the output.
 */
export function buildRolePrompt(role: RoleDefinition): string {
  const sections: string[] = [];

  if (role.identity !== "") {
    sections.push(`## Identity\n\n${role.identity}`);
  }

  if (role.prepare !== "") {
    sections.push(`## Prepare\n\n${role.prepare}`);
  }

  if (role.execute !== "") {
    sections.push(`## Execute\n\n${role.execute}`);
  }

  if (role.report !== "") {
    sections.push(`## Report\n\n${role.report}`);
  }

  return sections.join("\n\n");
}
