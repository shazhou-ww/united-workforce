import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateAdapterDevelopingReference,
  generateUsageReference,
  generateWorkflowAuthoringReference,
} from "@united-workforce/util";

// CLI package version (for bootstrap prompt — uwf --version prints this)
// Walk up from __dirname to find the nearest package.json (works from both src/ and dist/)
function _findCliVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === "@united-workforce/cli") {
        return pkg.version ?? "0.0.0";
      }
    } catch {
      // not found, keep walking
    }
    dir = dirname(dir);
  }
  return "0.0.0";
}
const CLI_VERSION = _findCliVersion();

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
pnpm bin -g       # prints the global bin directory
# For npm:
npm prefix -g     # global prefix; bin is <prefix>/bin
# The directory printed above MUST be in your PATH.
# Test: echo \\$PATH | tr ':' '\\\\n'
# FIX: add the missing directory to your shell's startup file
#   (e.g. ~/.bashrc, ~/.zshrc, ~/.profile, or fish config):
#   export PATH="<global-bin-dir>:$PATH"
\`\`\`

**All checks must pass before continuing.** If you had to modify PATH, verify the change persists by opening a new shell or sourcing your shell config.

### Step 1 — Discover agents and install adapter

**First, detect which supported agents are already installed on the user's machine:**

\`\`\`bash
# Check for Hermes Agent
which hermes 2>/dev/null && hermes --version

# Check for Claude Code
which claude 2>/dev/null && claude --version   # should show "X.Y.Z (Claude Code)"
\`\`\`

**Based on the results:**

- **Only hermes found** → install \`uwf-hermes\` adapter
- **Only claude found** → install \`uwf-claude-code\` adapter
- **Both found** → ask the user which agent they want uwf to use as default
- **Neither found** → the user must install at least one agent first:
  - Hermes Agent: https://hermes-agent.nousresearch.com/docs
  - Claude Code: \`npm install -g @anthropic-ai/claude-code\`

**Install the uwf CLI and the chosen adapter** using pnpm or npm:

\`\`\`bash
# CLI (required)
pnpm add -g @united-workforce/cli       # or: npm install -g @united-workforce/cli

# Adapter — install the one matching the detected agent:
pnpm add -g @united-workforce/agent-hermes       # or: npm i -g @united-workforce/agent-hermes
pnpm add -g @united-workforce/agent-claude-code   # or: npm i -g @united-workforce/agent-claude-code
\`\`\`

**⚠ Adapter versions are independent from CLI versions.** Do NOT try to match adapter version to CLI version. Just install \`@latest\` (the default).

**After installing, verify that \`uwf\` and the adapter are available in PATH:**

\`\`\`bash
uwf --version          # should print ${CLI_VERSION}
uwf-hermes --version   # or: uwf-claude-code --version
\`\`\`

If either command is not found, the global bin directory is not in the current shell's PATH. **You must fix this before continuing:**

1. Find where the binary was installed:
   \`\`\`bash
   find ~/.local ~/.hermes /usr/local -name uwf -type f 2>/dev/null
   npm prefix -g    # global prefix — bin is <prefix>/bin
   \`\`\`
2. Add the directory to PATH permanently by appending to the user's shell config (e.g. \`~/.bashrc\`, \`~/.zshrc\`, \`~/.profile\`, or fish config):
   \`\`\`bash
   export PATH="<global-bin-dir>:$PATH"
   \`\`\`
3. Source the updated config or open a new shell, then re-verify the commands work.

**uwf-hermes** also requires the Hermes ACP plugin. Verify with \`hermes acp --help\`. If not available, install it:
\`\`\`bash
# Option A: install into hermes venv (recommended)
source ~/.hermes/hermes-agent/.venv/bin/activate && pip install hermes-agent[acp]

# Option B: pipx
pipx install 'hermes-agent[acp]'

# Option C: if installed from source
pip install -e '.[acp]'
\`\`\`

### Step 2 — Configure provider and model

uwf needs an LLM provider to run agents. **Ask the user** for their provider, API key, and model, then run:

\`\`\`bash
uwf setup --provider <name> --api-key <key> --model <model> --agent <adapter-command>
\`\`\`

**Note:** \`--agent\` takes the adapter **command name** (e.g. \`uwf-hermes\`), not the npm package name.

**Preset providers** — when using a preset name, \`--base-url\` is auto-filled and can be omitted:

| Provider | Name | Default base URL |
|----------|------|-----------------|
| OpenAI | \`openai\` | https://api.openai.com/v1 |
| xAI | \`xai\` | https://api.x.ai/v1 |
| OpenRouter | \`openrouter\` | https://openrouter.ai/api/v1 |
| Venice | \`venice\` | https://api.venice.ai/api/v1 |
| Dashscope | \`dashscope\` | https://dashscope.aliyuncs.com/compatible-mode/v1 |
| DeepSeek | \`deepseek\` | https://api.deepseek.com/v1 |
| SiliconFlow | \`siliconflow\` | https://api.siliconflow.cn/v1 |
| VolcEngine | \`volcengine\` | https://ark.cn-beijing.volces.com/api/v3 |
| Kimi (Moonshot) | \`kimi\` | https://api.moonshot.cn/v1 |
| GLM (Zhipu AI) | \`glm\` | https://open.bigmodel.cn/api/paas/v4 |
| StepFun | \`stepfun\` | https://api.stepfun.com/v1 |
| MiniMax | \`minimax\` | https://api.minimax.io/v1 |
| Ollama (local) | \`ollama\` | http://localhost:11434/v1 |

For **non-preset providers**, you must specify \`--base-url\` manually.

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
        $status: { const: done }
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
# Using pnpm
pnpm add -g @united-workforce/cli@latest

# Using npm
npm install -g @united-workforce/cli@latest
\`\`\`

\`\`\`bash
uwf --version   # should print ${CLI_VERSION}
\`\`\`

Also update your adapter(s):

\`\`\`bash
# pnpm
pnpm add -g @united-workforce/agent-hermes@latest

# npm
npm install -g @united-workforce/agent-hermes@latest
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
