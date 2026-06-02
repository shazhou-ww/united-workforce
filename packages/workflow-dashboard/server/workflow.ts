import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RoleDefinition, Target, WorkflowPayload } from "@united-workforce/protocol";
import YAML from "yaml";
import type { WorkFlowSteps, WorkFlowTransition, WorkflowSummary } from "../shared/types.ts";

const WORKFLOW_DIR = join(import.meta.dirname, "..", "tmp", "workflow");

async function ensureDir() {
  await mkdir(WORKFLOW_DIR, { recursive: true });
}

function payloadToSteps(payload: WorkflowPayload): WorkFlowSteps {
  const steps: WorkFlowSteps = [];
  for (const [roleName, roleDef] of Object.entries(payload.roles)) {
    const statusMap = payload.graph[roleName] ?? {};
    const transitions: WorkFlowTransition[] = Object.entries(statusMap).map(([status, target]) => ({
      target: target.role === "$END" ? "END" : target.role,
      status,
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
  const graph: Record<string, Record<string, Target>> = {};

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

    const statusMap: Record<string, Target> = {};
    for (const t of step.transitions) {
      const targetRole = t.target === "END" ? "$END" : t.target;
      statusMap[t.status] = {
        role: targetRole,
        prompt: `Transition to ${targetRole}.`,
      };
    }
    graph[r.name] = statusMap;
  }

  if (steps.length > 0) {
    const firstRole = steps[0].role.name;
    graph.$START = {
      _: {
        role: firstRole,
        prompt: `Begin workflow at role ${firstRole}.`,
      },
    };
  }

  return { name, description, roles, graph };
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
