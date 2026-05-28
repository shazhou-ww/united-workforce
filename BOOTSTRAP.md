# UWF Bootstrap Guide

This guide helps any AI agent set up `uwf` (Uncaged Workflow) from scratch.

## Prerequisites

- **bun** — `uwf` is built with bun. Install: `curl -fsSL https://bun.sh/install | bash`
- **Network access** — to install npm packages

## 1. Install uwf CLI

```bash
bun install -g @uncaged/cli-workflow
```

Verify:

```bash
uwf --version
```

## 2. Install Agent Adapter

Install the adapter that matches your agent runtime. Pick **one**:

| Agent | Package | Binary |
|-------|---------|--------|
| Hermes | `@uncaged/workflow-agent-hermes` | `uwf-hermes` |

```bash
# Example: Hermes agent
bun install -g @uncaged/workflow-agent-hermes
```

## 3. Setup

Run the interactive wizard:

```bash
uwf setup
```

Or configure non-interactively:

```bash
uwf setup \
  --provider <name> \
  --base-url <url> \
  --api-key <key> \
  --model <model-name> \
  --agent hermes
```

This creates `~/.uncaged/workflow/config.yaml` with your provider, model, and default agent.

### Config Structure

```yaml
providers:
  my-provider:
    baseUrl: https://api.example.com/v1
    apiKey: sk-xxx
models:
  default:
    provider: my-provider
    name: my-model
agents:
  hermes:
    command: uwf-hermes
    args: []
defaultAgent: hermes
defaultModel: default
```

## 4. Verify Installation

```bash
# List workflows (should return empty or existing ones)
uwf workflow list

# Check built-in help
uwf skill user     # usage guide
uwf skill author   # workflow authoring guide
```

## 5. Add the uwf Skill

Copy the skill file from this repo into your agent's skill library:

```bash
# For Hermes agents with skills at ~/.hermes/skills/
mkdir -p ~/.hermes/skills/devops/uwf
cp skills/uwf-skill.md ~/.hermes/skills/devops/uwf/SKILL.md
```

The skill teaches the agent to use `uwf skill user` and `uwf skill author` for detailed reference, keeping the skill itself minimal.

## 6. Quick Smoke Test

```bash
# Register an example workflow
uwf workflow add examples/analyze-topic.yaml

# Start a thread
uwf thread start analyze-topic -p "Analyze the concept of technical debt"

# Execute it (runs one moderator → agent → extract cycle)
uwf thread exec <thread-id>
```

## Done

The agent now has `uwf` + agent adapter installed, configured, and a skill to guide future usage. For workflow authoring details, run `uwf skill author`.
