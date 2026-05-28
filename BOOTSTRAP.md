# UWF Bootstrap Guide

This guide helps any AI agent set up `uwf` (Uncaged Workflow) from scratch — or self-check and upgrade an existing installation.

## Prerequisites

- **bun** — `uwf` is built with bun. Install: `curl -fsSL https://bun.sh/install | bash`
- **Network access** — to install npm packages

> **Already have uwf?** Jump to [Self-Check & Upgrade](#self-check--upgrade).

---

## Fresh Install

### 1. Install uwf CLI

```bash
bun install -g @uncaged/cli-workflow
```

✅ **Check:** `uwf --version` prints a version number (e.g. `0.5.1`).

### 2. Install Agent Adapter

Install the adapter that matches your agent runtime. Pick **one**:

| Agent | Package | Binary |
|-------|---------|--------|
| Hermes | `@uncaged/workflow-agent-hermes` | `uwf-hermes` |

```bash
# Example: Hermes agent
bun install -g @uncaged/workflow-agent-hermes
```

✅ **Check:** `uwf-hermes --version` prints a version number.

### 3. Setup

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

#### Config Structure

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

✅ **Check:** `cat ~/.uncaged/workflow/config.yaml` shows valid provider, model, and agent config.

### 4. Verify Installation

```bash
uwf workflow list    # should return empty array or existing workflows
uwf skill user       # prints usage guide
uwf skill author     # prints workflow authoring guide
```

✅ **Check:** All three commands run without errors.

### 5. Add the uwf Skill

```bash
mkdir -p ~/.hermes/skills/devops/uwf
uwf skill bootstrap > ~/.hermes/skills/devops/uwf/SKILL.md
```

✅ **Check:** `cat ~/.hermes/skills/devops/uwf/SKILL.md` shows the skill content with triggers `uwf`, `workflow`, `工作流`.

### 6. Smoke Test

```bash
# Register an example workflow
uwf workflow add examples/analyze-topic.yaml

# Start a thread
uwf thread start analyze-topic -p "Analyze the concept of technical debt"

# Execute it (one moderator → agent → extract cycle)
uwf thread exec <thread-id>
```

✅ **Check:** Thread reaches `completed` status. Verify with `uwf thread list`.

---

## Self-Check & Upgrade

Already have uwf installed? Run through this checklist to verify and upgrade.

### Version Check

```bash
uwf --version
uwf-hermes --version   # or your agent adapter
```

Compare with latest published versions:

```bash
bun pm ls -g | grep -E "cli-workflow|workflow-agent"
npm info @uncaged/cli-workflow version
npm info @uncaged/workflow-agent-hermes version
```

If local version < published version, upgrade:

```bash
bun install -g @uncaged/cli-workflow@latest
bun install -g @uncaged/workflow-agent-hermes@latest
```

✅ **Check:** `uwf --version` matches `npm info @uncaged/cli-workflow version`.

### Config Check

```bash
cat ~/.uncaged/workflow/config.yaml
```

Verify:
- [ ] `providers` has at least one entry with valid `baseUrl` and `apiKey`
- [ ] `models.default` references an existing provider
- [ ] `agents` has your adapter configured
- [ ] `defaultAgent` and `defaultModel` are set

### Skill Check

```bash
cat ~/.hermes/skills/devops/uwf/SKILL.md
```

Verify the skill is up to date:

```bash
uwf skill bootstrap | diff - ~/.hermes/skills/devops/uwf/SKILL.md
```

If `diff` produces any output, the local skill is outdated. Update:

```bash
uwf skill bootstrap > ~/.hermes/skills/devops/uwf/SKILL.md
```

### Functional Check

```bash
uwf workflow list      # should not error
uwf skill user         # should print usage guide
uwf skill author       # should print authoring guide
```

✅ All green? You're good to go.
