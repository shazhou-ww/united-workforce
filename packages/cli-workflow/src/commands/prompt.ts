import {
  generateAdapterReference,
  generateAuthorReference,
  generateBootstrapReference,
  generateDeveloperReference,
  generateUserReference,
} from "@uncaged/workflow-util";

export {
  generateAdapterReference as cmdPromptAdapter,
  generateAuthorReference as cmdPromptAuthor,
  generateBootstrapReference as cmdPromptBootstrap,
  generateDeveloperReference as cmdPromptDeveloper,
  generateUserReference as cmdPromptUser,
};

const PROMPT_ENTRIES: ReadonlyArray<{ name: string; generate: () => string }> = [
  { name: "user", generate: generateUserReference },
  { name: "author", generate: generateAuthorReference },
  { name: "developer", generate: generateDeveloperReference },
  { name: "adapter", generate: generateAdapterReference },
  { name: "bootstrap", generate: generateBootstrapReference },
];

export function cmdPromptList(): ReadonlyArray<string> {
  return PROMPT_ENTRIES.map((e) => e.name);
}

export function cmdPromptUsage(): string {
  return PROMPT_ENTRIES.map((e) => e.generate()).join("\n\n---\n\n");
}

export function cmdPromptSetup(): string {
  return `# uwf Skill Setup

You are being asked to install or update the uwf (United Workforce) skill
so that you know how to use the \`uwf\` CLI for workflow orchestration.

## Steps

1. **Check if uwf CLI is installed:**
   \`\`\`bash
   uwf --help
   \`\`\`
   If not installed: \`bun add -g @uncaged/cli-workflow\`

2. **Clean up old versions of the skill** (if any exist):
   - Look for any existing uwf/workflow skill files in your skill directories
     (e.g. \`~/.hermes/skills/uwf/SKILL.md\` or similar paths).
   - If a skill exists, read its \`version\` from the YAML frontmatter.
   - If the version matches the current CLI version (\`uwf --version\`), you're done — no update needed.
   - If the version is older, **delete the old skill file** before proceeding.

3. **Get the usage skill content:**
   \`\`\`bash
   uwf prompt usage
   \`\`\`

4. **Create a SKILL.md file** in your skill directory (e.g. \`~/.hermes/skills/uwf/SKILL.md\`).
   The output of \`uwf prompt usage\` is the skill body WITHOUT frontmatter.
   You must prepend the following YAML frontmatter:

   \`\`\`yaml
   ---
   name: uwf
   description: "Use when orchestrating multi-agent workflows with uwf (United Workforce). Covers CLI usage, workflow YAML authoring, moderator logic, and agent development."
   version: <VERSION>
   author: United Workforce
   license: MIT
   metadata:
     hermes:
       tags: [workflow, agents, orchestration, cli, yaml]
   ---
   \`\`\`

   Replace \`<VERSION>\` with the installed CLI version (from \`uwf --version\`).

5. **Verify** the skill is loadable by your agent framework.

## Individual prompts

You can also get individual reference sections:

\`\`\`bash
uwf prompt list                # list available prompt names
uwf prompt user                # user reference (CLI guide + typical workflows)
uwf prompt author              # author reference (workflow YAML design guide)
uwf prompt developer           # developer reference (coding conventions + architecture)
uwf prompt adapter             # adapter reference (building agent adapters)
uwf prompt bootstrap           # bootstrap skill YAML for Hermes agents
\`\`\`

## Notes

- The skill content is bundled with the CLI and versioned with it — always use
  \`uwf prompt usage\` to get the content matching your installed version.
- Do NOT hand-edit the skill body. If the CLI is updated, re-run \`uwf prompt setup\`
  and follow the steps again.
- When upgrading, always delete the old skill first to avoid stale instructions.
`;
}
