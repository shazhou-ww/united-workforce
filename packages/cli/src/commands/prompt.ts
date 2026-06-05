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
  return `# uwf Bootstrap

Set up or upgrade uwf (United Workforce) — from zero to running your first workflow.

## Scenario A: Fresh Install

### Step 0 — Environment pre-flight check

Run ALL checks below BEFORE installing anything. If any check fails, fix it first — do NOT skip ahead.

\`\`\`bash
# 1. Node.js
node --version   # need v20+
# FIX: install via nvm (https://github.com/nvm-sh/nvm) or your OS package manager

# 2. Package manager — pnpm (preferred) or npm
pnpm --version || npm --version
# FIX for pnpm: corepack enable pnpm   (Node 20+)
#   or: npm install -g pnpm
# If pnpm is not an option, npm works too — adjust install commands below

# 3. Global bin directory is in PATH
# For pnpm:
pnpm root -g 2>/dev/null && pnpm bin -g
# For npm:
npm prefix -g
# The "bin" directory printed above MUST be in your PATH.
# Test: echo $PATH | tr ':' '\\n' | grep -E "(pnpm|npm|node)"
# FIX: add the bin directory to ~/.profile or ~/.bashrc:
#   export PATH="$(pnpm bin -g):$PATH"   # pnpm
#   export PATH="$(npm prefix -g)/bin:$PATH"  # npm

# 4. (uwf-hermes only) hermes CLI
which hermes
# FIX: if hermes is in a virtualenv, add it to PATH:
#   export PATH="$HOME/.hermes/hermes-agent/.venv/bin:$PATH"
#   or create a symlink: ln -s ~/.hermes/hermes-agent/.venv/bin/hermes ~/.local/bin/hermes
\`\`\`

**All checks must pass before continuing.** If you had to modify PATH, verify the change persists by opening a new shell or sourcing your profile.

### Step 1 — Install CLI and agent adapter

\`\`\`bash
pnpm add -g @united-workforce/cli    # or: npm install -g @united-workforce/cli
uwf --version   # should print ${VERSION}
\`\`\`

Install an agent adapter (at least one is required):

| Adapter | Install | When to use |
|---------|---------|-------------|
| uwf-hermes | \`pnpm add -g @united-workforce/agent-hermes\` | When your agent framework is Hermes Agent |
| uwf-claude-code | \`pnpm add -g @united-workforce/agent-claude-code\` | When using Claude Code CLI directly |
| uwf-builtin | \`pnpm add -g @united-workforce/agent-builtin\` | Lightweight built-in agent (no external dependency) |

**uwf-hermes** also requires the Hermes ACP plugin. After installing \`hermes-agent\`, run:
\`\`\`bash
pip install hermes-agent[acp]   # or: pip install -e .[acp] if installed from source
\`\`\`

Verify the adapter is installed: \`uwf-hermes --version\` (or whichever you chose).

### Step 2 — Configure provider and model

uwf needs an LLM provider to run agents. **Ask the user** for their provider, API key, and model, then run:

\`\`\`bash
uwf setup --provider <name> --base-url <url> --api-key <key> --model <model> [--agent <adapter>]
\`\`\`

Preset providers (base-url is auto-filled when using a preset name):
openai, xai, openrouter, venice, dashscope, deepseek, siliconflow, volcengine, kimi, glm, stepfun, minimax, ollama

Example:
\`\`\`bash
uwf setup --provider openrouter --api-key sk-or-... --model anthropic/claude-sonnet-4 --agent uwf-hermes
\`\`\`

If the user doesn't know what to choose, suggest \`openrouter\` with \`anthropic/claude-sonnet-4\` as a sensible default.

Config is saved to \`~/.uwf/config.yaml\`. Verify with \`cat ~/.uwf/config.yaml\`.

### Step 3 — Install skills

Run each command and create a skill from its output:

\`\`\`bash
uwf prompt usage               # → save as skill "uwf-usage"
uwf prompt workflow-authoring  # → save as skill "uwf-workflow-authoring"
uwf prompt adapter-developing  # → save as skill "uwf-adapter-developing"
\`\`\`

Each command outputs a complete SKILL.md with YAML frontmatter. Use your agent framework's skill creation API to save them (e.g. \`skill_manage(action='create', name='uwf-usage', content=<output>)\`).

Verify skills are installed by listing them (e.g. \`skills_list()\`) and confirming all three appear.

### Step 4 — Verify end-to-end

Create a minimal workflow file to test your setup:

\`\`\`bash
cat > /tmp/hello.yaml << 'YAML'
name: hello
description: Minimal smoke test
roles:
  greeter:
    description: "Greet the user"
    goal: "Respond with a friendly greeting"
    capabilities: []
    procedure: "Write a short greeting based on the prompt."
    output: "A greeting message."
    frontmatter:
      type: object
      properties:
        $status: { enum: [done] }
        message: { type: string }
      required: [$status, message]
graph:
  $START:
    new: { role: greeter, prompt: "Say hello to the user." }
    resume: { role: greeter, prompt: "Greet the user again." }
  greeter:
    done: { role: "$END", prompt: "Done." }
YAML
\`\`\`

Then run:

\`\`\`bash
uwf thread start /tmp/hello.yaml -p "Hello, world!"
uwf thread exec <thread-id>
uwf thread show <thread-id>
\`\`\`

If the thread reaches \`$END\` with status \`completed\`, the setup is working.

## Scenario B: Upgrade from Previous Version

### Step 1 — Update packages

\`\`\`bash
pnpm add -g @united-workforce/cli@latest    # or: npm install -g @united-workforce/cli@latest
uwf --version   # should print ${VERSION}

# Also update your adapter(s)
pnpm add -g @united-workforce/agent-hermes@latest
\`\`\`

### Step 2 — Regenerate skills

Skill content is bundled with the CLI — always regenerate after upgrading:

\`\`\`bash
uwf prompt usage               # → update skill "uwf-usage"
uwf prompt workflow-authoring  # → update skill "uwf-workflow-authoring"
uwf prompt adapter-developing  # → update skill "uwf-adapter-developing"
\`\`\`

### Step 3 — Migrate workflow YAML files (if needed)

Check the changelog for breaking changes. Known migrations:

- **v0.2.0**: \`$START._\` → \`$START.new\` + \`$START.resume\`. All workflow YAML files must be updated:
  \`\`\`yaml
  # Before (v0.1.x)
  $START:
    _: { role: planner, prompt: "..." }

  # After (v0.2.0+)
  $START:
    new: { role: planner, prompt: "..." }
    resume: { role: planner, prompt: "Review previous run and continue." }
  \`\`\`

Update all \`.workflow/\` and \`.workflows/\` YAML files in your projects. \`uwf workflow add\` will reject files with the old \`_\` syntax.

### Step 4 — Verify

\`\`\`bash
uwf thread start <your-workflow> -p "upgrade test"
uwf thread exec <thread-id>
\`\`\`

## Available prompts

\`\`\`bash
uwf prompt list                # list available prompt names
uwf prompt usage               # CLI usage guide
uwf prompt workflow-authoring  # workflow YAML design guide
uwf prompt adapter-developing  # building agent adapters
uwf prompt bootstrap           # this guide
\`\`\`
`;
}
