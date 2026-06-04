import {
  generateAdapterDevelopingReference,
  generateBootstrapReference,
  generateUsageReference,
  generateWorkflowAuthoringReference,
} from "@united-workforce/util";

export {
  generateAdapterDevelopingReference as cmdPromptAdapterDeveloping,
  generateBootstrapReference as cmdPromptBootstrap,
  generateUsageReference as cmdPromptUsageReference,
  generateWorkflowAuthoringReference as cmdPromptWorkflowAuthoring,
};

const PROMPT_ENTRIES: ReadonlyArray<{ name: string; generate: () => string }> = [
  { name: "usage", generate: generateUsageReference },
  { name: "workflow-authoring", generate: generateWorkflowAuthoringReference },
  { name: "adapter-developing", generate: generateAdapterDevelopingReference },
  { name: "bootstrap", generate: generateBootstrapReference },
];

export function cmdPromptList(): ReadonlyArray<string> {
  return PROMPT_ENTRIES.map((e) => e.name);
}

export function cmdPromptUsage(): string {
  return PROMPT_ENTRIES.filter((e) => e.name !== "bootstrap")
    .map((e) => e.generate())
    .join("\n\n---\n\n");
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
   If not installed: \`npm install -g @united-workforce/cli\`

2. **Clean up old versions of the skill** (if any exist):
   - Look for any existing uwf/workflow skill files in your skill directories
     (e.g. \`~/.hermes/skills/uwf/SKILL.md\` or similar paths).
   - If a skill exists, read its \`version\` from the YAML frontmatter.
   - If the version matches the current CLI version (\`uwf --version\`), you're done — no update needed.
   - If the version is older, **delete the old skill file** before proceeding.

3. **Install the bootstrap skill:**
   \`\`\`bash
   uwf prompt bootstrap > ~/.hermes/skills/uwf/SKILL.md
   \`\`\`
   The bootstrap prompt already includes complete YAML frontmatter — no editing needed.

4. **Verify** the skill is loadable by your agent framework.

## Individual prompts

Each prompt outputs a complete SKILL.md with frontmatter — pipe directly to a file:

\`\`\`bash
uwf prompt list                                              # list available prompt names
uwf prompt usage > ~/.hermes/skills/uwf-usage/SKILL.md      # CLI usage guide
uwf prompt workflow-authoring > ~/.hermes/skills/uwf-workflow-authoring/SKILL.md
uwf prompt adapter-developing > ~/.hermes/skills/uwf-adapter-developing/SKILL.md
uwf prompt bootstrap > ~/.hermes/skills/uwf/SKILL.md        # bootstrap skill
\`\`\`

## Notes

- The skill content is bundled with the CLI and versioned with it — always use
  \`uwf prompt usage\` to get the content matching your installed version.
- Do NOT hand-edit the skill body. If the CLI is updated, re-run \`uwf prompt setup\`
  and follow the steps again.
- When upgrading, always delete the old skill first to avoid stale instructions.
`;
}
