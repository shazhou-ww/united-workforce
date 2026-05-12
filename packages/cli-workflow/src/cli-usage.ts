import type { CommandGroup } from "./cli-command-types.js";

/** Keep aligned with `getSkillTopics()` in skill.ts (names only, for error usage lines). */
export const USAGE_SKILL_TOPIC_ROWS: ReadonlyArray<{ name: string }> = [
  { name: "cli" },
  { name: "develop" },
  { name: "author" },
];

const USAGE_SECTION_BY_GROUP: Record<string, string> = {
  workflow: "Workflow registry:",
  thread: "Thread execution:",
  cas: "Content-addressable storage:",
  init: "Development:",
  setup: "Configuration:",
};

export function formatUsageCommandLines(
  rows: ReadonlyArray<{ prefix: string; description: string }>,
): string[] {
  const maxPrefix = rows.reduce((max, row) => Math.max(max, row.prefix.length), 0);
  const gap = 2;
  return rows.map((row) => {
    const pad = " ".repeat(maxPrefix - row.prefix.length + gap);
    return `  ${row.prefix}${pad}${row.description}`;
  });
}

export function formatCliUsage(
  groups: ReadonlyArray<CommandGroup>,
  skillTopics: ReadonlyArray<{ name: string }>,
): string {
  const lines: string[] = ["uncaged-workflow — workflow engine CLI", ""];

  for (const group of groups) {
    const sectionTitle = USAGE_SECTION_BY_GROUP[group.name];
    if (sectionTitle === undefined) {
      throw new Error(`BUG: missing usage section title for group "${group.name}"`);
    }
    lines.push(sectionTitle);
    const rows = group.commands.map((cmd) => {
      const namePart = cmd.name === "" ? "" : ` ${cmd.name}`;
      const args = cmd.args ? ` ${cmd.args}` : "";
      return {
        prefix: `${group.name}${namePart}${args}`,
        description: cmd.description,
      };
    });
    lines.push(...formatUsageCommandLines(rows));
    lines.push("");
  }

  lines.push("Shortcuts:");
  lines.push(
    ...formatUsageCommandLines([
      { prefix: "run <name> [...]", description: "→ thread run" },
      { prefix: "live <id> [...]", description: "→ thread live" },
    ]),
  );
  lines.push("");

  lines.push("Server:");
  lines.push(
    ...formatUsageCommandLines([
      {
        prefix: "serve [--port N] [--host ADDR]",
        description: "Start HTTP API server (default: 127.0.0.1:7860)",
      },
    ]),
  );
  lines.push("");

  lines.push("Reference:");
  const skillTopicNames = skillTopics.map((t) => t.name).join(", ");
  lines.push(
    ...formatUsageCommandLines([
      {
        prefix: "skill [topic]",
        description: `Agent-consumable docs (${skillTopicNames})`,
      },
    ]),
  );
  lines.push("");
  lines.push("Use <command> --help for subcommand details.");
  lines.push("");
  lines.push("Environment variables:");
  lines.push(
    "  WORKFLOW_STORAGE_ROOT              Override storage directory (default: ~/.uncaged/workflow)",
  );
  lines.push(
    "  UNCAGED_WORKFLOW_STORAGE_ROOT      Internal override (takes priority over WORKFLOW_STORAGE_ROOT)",
  );
  return lines.join("\n");
}
