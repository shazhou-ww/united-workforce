import type { RoleDefinition } from "@united-workforce/protocol";
import { generateCliReference } from "@united-workforce/util";

/**
 * Build the role prompt from a RoleDefinition.
 *
 * Assembles structured sections: Goal, Capabilities, Prepare, Procedure, Output.
 * Empty strings and empty arrays are omitted from the output.
 *
 * The Prepare section always inlines the uwf CLI reference so the agent has
 * workflow knowledge without needing to run an external command. The capabilities
 * array is rendered as keyword hints for implicit skill loading.
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

  const prepareLines: string[] = [generateCliReference()];
  if (role.capabilities.length > 0) {
    const keywords = role.capabilities.join(", ");
    prepareLines.push(
      `You have the following capabilities: ${keywords}. Load relevant skills matching these keywords before starting work.`,
    );
  }
  sections.push(`## Prepare\n\n${prepareLines.join("\n\n")}`);

  if (role.procedure !== "") {
    sections.push(`## Procedure\n\n${role.procedure}`);
  }

  if (role.output !== "") {
    sections.push(`## Output\n\n${role.output}`);
  }

  return sections.join("\n\n");
}
