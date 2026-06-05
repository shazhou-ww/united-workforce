export function generateModeratorReference(): string {
  return `# Moderator Reference

## Overview

The moderator is the workflow engine's routing component. It evaluates the directed graph defined in the workflow YAML to determine the next role (or \`$END\`) after each step — with zero LLM cost.

## Status-Based Routing

The moderator uses **status-based routing**: it inspects the previous step's extracted output (specifically the \`$status\` field) and looks up the corresponding edge in the graph.

### Graph Structure

The graph is a nested map: \`Record<Role | "$START", Record<Status, Target>>\`. Each role maps its possible \`$status\` values to a target with a \`role\` and \`prompt\`:

\`\`\`yaml
graph:
  $START:
    new: { role: planner, prompt: "Analyze the issue." }
    resume: { role: planner, prompt: "Review the previous run output and continue." }
  planner:
    ready: { role: developer, prompt: "Implement the plan (CAS hash: {{{plan}}})." }
    insufficient_info: { role: $END, prompt: "Not enough info." }
  developer:
    done: { role: reviewer, prompt: "Review branch {{{branch}}} at {{{worktree}}}." }
    failed: { role: $END, prompt: "Developer failed: {{{reason}}}." }
  reviewer:
    approved: { role: tester, prompt: "Run tests on {{{branch}}} at {{{worktree}}}." }
    rejected: { role: developer, prompt: "Fix issues: {{{comments}}}." }
\`\`\`

### Routing Algorithm

1. Look up \`graph[lastRole]\` to get the status map for the current role
2. Look up \`statusMap[lastOutput.$status]\` to get the target
3. If target role is \`$END\`, mark thread as completed
4. Otherwise, render the edge prompt (Mustache templates with \`{{{field}}}\` from output) and spawn the next agent

### Edge Prompts and Mustache Templates

Edge prompts use triple-brace Mustache syntax (\`{{{field}}}\`) to interpolate values from the previous step's output into the next agent's task prompt. This passes structured data (branch names, file paths, CAS hashes) between roles without manual wiring.

## Special Nodes

- \`$START\` — entry point; uses status keys \`new\` (first start) and \`resume\` (resuming a completed thread)
- \`$END\` — terminal node; thread completes when reached and is moved to history

## Integration with Steps

Each \`uwf thread exec\` cycle:
1. Moderator reads the thread's head step output
2. Looks up \`graph[lastRole][output.$status]\` to pick the next role
3. If next is \`$END\`, marks thread as completed
4. Otherwise, renders the edge prompt and spawns the agent for the selected role
5. Extract pipeline parses agent output → new step node → append to CAS chain
`;
}
