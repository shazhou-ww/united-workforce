import {
  generateAdapterDevelopingReference,
  generateUsageReference,
  generateWorkflowAuthoringReference,
  VERSION,
} from "@united-workforce/util";

export {
  generateAdapterDevelopingReference as cmdPromptAdapterDeveloping,
  generateUsageReference as cmdPromptUsage,
  generateWorkflowAuthoringReference as cmdPromptWorkflowAuthoring,
};

const PROMPT_ENTRIES: ReadonlyArray<{ name: string; generate: () => string }> = [
  { name: "usage", generate: generateUsageReference },
  { name: "workflow-authoring", generate: generateWorkflowAuthoringReference },
  { name: "adapter-developing", generate: generateAdapterDevelopingReference },
];

export function cmdPromptList(): ReadonlyArray<string> {
  return PROMPT_ENTRIES.map((e) => e.name);
}

export function cmdPromptBootstrap(): string {
  return `# uwf Skill Bootstrap

Install or update the uwf (United Workforce) skills for your agent.

## Steps

1. **Check if uwf CLI is installed:**
   \`\`\`bash
   uwf --help
   \`\`\`
   If not installed: \`npm install -g @united-workforce/cli\`
   Current version: ${VERSION}

2. **Install the skills** by running each command below and creating a skill from its output:
   - Run \`uwf prompt usage\` → create a skill named \`uwf-usage\`
   - Run \`uwf prompt workflow-authoring\` → create a skill named \`uwf-workflow-authoring\`
   - Run \`uwf prompt adapter-developing\` → create a skill named \`uwf-adapter-developing\`

   Each command outputs a complete SKILL.md with YAML frontmatter — use your agent framework's skill creation API to save them.

3. **Verify** the skills are loadable by your agent framework.

## Updating

When \`uwf\` is upgraded, re-run \`uwf prompt bootstrap\` and follow the steps again.
The skill content is bundled with the CLI — always use \`uwf prompt <name>\` to get
content matching your installed version.

## Available prompts

\`\`\`bash
uwf prompt list                # list available prompt names
uwf prompt usage               # CLI usage guide
uwf prompt workflow-authoring  # workflow YAML design guide
uwf prompt adapter-developing  # building agent adapters
\`\`\`
`;
}
