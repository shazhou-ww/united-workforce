import type { RoleDefinition } from "@uncaged/workflow-protocol";

/**
 * Build the role prompt from a RoleDefinition.
 *
 * Assembles structured sections: Goal, Capabilities, Prepare, Procedure, Output.
 * Empty strings and empty arrays are omitted from the output.
 *
 * The Prepare section always instructs the agent to run `uwf skill cli` to load
 * workflow knowledge, plus renders the capabilities array as keyword hints for
 * implicit skill loading.
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

  const prepareLines: string[] = [
    "Run the following command to load workflow CLI knowledge before starting work:",
    "",
    "```",
    "uwf skill cli",
    "```",
  ];
  if (role.capabilities.length > 0) {
    const keywords = role.capabilities.join(", ");
    prepareLines.push(
      "",
      `You have the following capabilities: ${keywords}. Load relevant skills matching these keywords before starting work.`,
    );
  }
  sections.push(`## Prepare\n\n${prepareLines.join("\n")}`);

  if (role.procedure !== "") {
    sections.push(`## Procedure\n\n${role.procedure}`);
  }

  if (role.output !== "") {
    sections.push(`## Output\n\n${role.output}`);
  }

  return sections.join("\n\n");
}
