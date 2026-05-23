import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RoleDefinition, Transition, WorkflowPayload } from "@uncaged/workflow-protocol";
import YAML from "yaml";
import type { WorkFlowSteps, WorkFlowTransition, WorkflowSummary } from "../shared/types.ts";

const WORKFLOW_DIR = join(import.meta.dirname, "..", "tmp", "workflow");

async function ensureDir() {
  await mkdir(WORKFLOW_DIR, { recursive: true });
}

function payloadToSteps(payload: WorkflowPayload): WorkFlowSteps {
  const conditionMap = new Map<string, string>();
  for (const [name, def] of Object.entries(payload.conditions)) {
    conditionMap.set(name, def.expression);
  }

  const steps: WorkFlowSteps = [];
  for (const [roleName, roleDef] of Object.entries(payload.roles)) {
    const graphTransitions = payload.graph[roleName] ?? [];
    const transitions: WorkFlowTransition[] = graphTransitions.map((t) => ({
      target: t.role === "$END" ? "END" : t.role,
      condition: t.condition ? (conditionMap.get(t.condition) ?? t.condition) : null,
    }));

    steps.push({
      role: {
        name: roleName,
        description: roleDef.description,
        identity: roleDef.goal,
        prepare: roleDef.capabilities.join("\n"),
        execute: roleDef.procedure,
        report: roleDef.output,
      },
      transitions,
    });
  }

  return steps;
}

function stepsToPayload(name: string, description: string, steps: WorkFlowSteps): WorkflowPayload {
  const roles: Record<string, RoleDefinition> = {};
  const conditions: WorkflowPayload["conditions"] = {};
  const graph: Record<string, Transition[]> = {};

  const expressionToName = new Map<string, string>();
  let condIdx = 0;

  for (const step of steps) {
    const r = step.role;
    roles[r.name] = {
      description: r.description,
      goal: r.identity,
      capabilities: r.prepare ? r.prepare.split("\n").filter(Boolean) : [],
      procedure: r.execute,
      output: r.report,
      frontmatter: "",
    };

    const transitions: Transition[] = step.transitions.map((t) => {
      let condName: string | null = null;
      if (t.condition) {
        if (expressionToName.has(t.condition)) {
          condName = expressionToName.get(t.condition) ?? null;
        } else {
          condName = `cond${condIdx++}`;
          expressionToName.set(t.condition, condName);
          conditions[condName] = {
            description: "",
            expression: t.condition,
          };
        }
      }
      const targetRole = t.target === "END" ? "$END" : t.target;
      return {
        role: targetRole,
        condition: condName,
        prompt: `Transition to ${targetRole}.`,
      };
    });

    graph[r.name] = transitions;
  }

  if (steps.length > 0) {
    const firstRole = steps[0].role.name;
    graph.$START = [
      {
        role: firstRole,
        condition: null,
        prompt: `Begin workflow at role ${firstRole}.`,
      },
    ];
  }

  return { name, description, roles, conditions, graph };
}

export async function listWorkflows(): Promise<WorkflowSummary[]> {
  await ensureDir();
  const files = await readdir(WORKFLOW_DIR);
  const results: WorkflowSummary[] = [];

  for (const file of files) {
    if (!file.endsWith(".yaml")) continue;
    const content = await readFile(join(WORKFLOW_DIR, file), "utf-8");
    const payload = YAML.parse(content) as WorkflowPayload;
    results.push({ name: payload.name, description: payload.description });
  }

  return results;
}

export async function getWorkflow(name: string): Promise<WorkFlowSteps> {
  const content = await readFile(join(WORKFLOW_DIR, `${name}.yaml`), "utf-8");
  const payload = YAML.parse(content) as WorkflowPayload;
  return payloadToSteps(payload);
}

export async function createWorkflow(name: string, description: string): Promise<void> {
  await ensureDir();
  const payload: WorkflowPayload = {
    name,
    description,
    roles: {},
    conditions: {},
    graph: {},
  };
  await writeFile(join(WORKFLOW_DIR, `${name}.yaml`), YAML.stringify(payload), "utf-8");
}

export async function saveWorkflow(name: string, steps: WorkFlowSteps): Promise<void> {
  const filePath = join(WORKFLOW_DIR, `${name}.yaml`);
  let description = "";
  try {
    const existing = await readFile(filePath, "utf-8");
    const existingPayload = YAML.parse(existing) as WorkflowPayload;
    description = existingPayload.description;
  } catch {
    // file doesn't exist, use empty description
  }
  const payload = stepsToPayload(name, description, steps);
  await writeFile(filePath, YAML.stringify(payload), "utf-8");
}

export async function deleteWorkflow(name: string): Promise<void> {
  await unlink(join(WORKFLOW_DIR, `${name}.yaml`));
}
