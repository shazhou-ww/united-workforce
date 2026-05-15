import { err, ok, type Result } from "@uncaged/workflow-util";

import type {
  WorkflowDescriptor,
  WorkflowGraph,
  WorkflowGraphEdge,
  WorkflowRoleDescriptor,
  WorkflowRoleSchema,
} from "./types.js";

function validateDescriptorGraphEdge(
  item: unknown,
  index: number,
): Result<WorkflowGraphEdge, string> {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return err(`descriptor.graph.edges[${index}] must be a non-array object`);
  }
  const e = item as Record<string, unknown>;
  if (typeof e.from !== "string") {
    return err(`descriptor.graph.edges[${index}].from must be a string`);
  }
  if (typeof e.to !== "string") {
    return err(`descriptor.graph.edges[${index}].to must be a string`);
  }
  if (typeof e.condition !== "string") {
    return err(`descriptor.graph.edges[${index}].condition must be a string`);
  }
  const cdRaw = e.conditionDescription;
  if (cdRaw !== null && cdRaw !== undefined && typeof cdRaw !== "string") {
    return err(`descriptor.graph.edges[${index}].conditionDescription must be a string or null`);
  }
  const conditionDescription: string | null = cdRaw === undefined || cdRaw === null ? null : cdRaw;
  return ok({
    from: e.from,
    to: e.to,
    condition: e.condition,
    conditionDescription,
  });
}

function validateDescriptorGraph(graphRaw: unknown): Result<WorkflowGraph, string> {
  if (graphRaw === null || typeof graphRaw !== "object" || Array.isArray(graphRaw)) {
    return err("descriptor.graph must be a non-array object");
  }
  const graphRecord = graphRaw as Record<string, unknown>;
  const edgesRaw = graphRecord.edges;
  if (!Array.isArray(edgesRaw)) {
    return err("descriptor.graph.edges must be an array");
  }

  const edges: WorkflowGraphEdge[] = [];
  for (let i = 0; i < edgesRaw.length; i++) {
    const edgeResult = validateDescriptorGraphEdge(edgesRaw[i], i);
    if (!edgeResult.ok) {
      return edgeResult;
    }
    edges.push(edgeResult.value);
  }

  return ok({ edges });
}

export function validateWorkflowDescriptor(value: unknown): Result<WorkflowDescriptor, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return err("descriptor must be a non-array object");
  }
  const root = value as Record<string, unknown>;
  const description = root.description;
  if (typeof description !== "string") {
    return err("descriptor.description must be a string");
  }
  const rolesRaw = root.roles;
  if (rolesRaw === null || typeof rolesRaw !== "object" || Array.isArray(rolesRaw)) {
    return err("descriptor.roles must be a non-array object");
  }

  const roles: Record<string, WorkflowRoleDescriptor> = {};
  for (const [roleName, specUnknown] of Object.entries(rolesRaw)) {
    if (specUnknown === null || typeof specUnknown !== "object" || Array.isArray(specUnknown)) {
      return err(`descriptor.roles.${roleName} must be a non-array object`);
    }
    const spec = specUnknown as Record<string, unknown>;
    const roleDesc = spec.description;
    if (typeof roleDesc !== "string") {
      return err(`descriptor.roles.${roleName}.description must be a string`);
    }
    const schema = spec.schema;
    if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
      return err(`descriptor.roles.${roleName}.schema must be a non-array object`);
    }
    const systemPrompt = typeof spec.systemPrompt === "string" ? spec.systemPrompt : "";
    roles[roleName] = {
      description: roleDesc,
      systemPrompt,
      schema: schema as WorkflowRoleSchema,
    };
  }

  const graphResult = validateDescriptorGraph(root.graph);
  if (!graphResult.ok) {
    return graphResult;
  }

  return ok({ description, roles, graph: graphResult.value });
}
