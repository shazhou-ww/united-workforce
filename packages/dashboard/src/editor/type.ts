import type { Edge, Node } from "@xyflow/react";

type AnyKeyBase = { [key: string]: unknown | undefined };

export type RoleNodeData = AnyKeyBase & {
  name: string;
  description: string;
  identity: string;
  prepare: string;
  execute: string;
  report: string;
};

export type NodeMap = {
  start: { label: string };
  end: { label: string };
  role: RoleNodeData;
};

export type WorkNodeType = keyof NodeMap;
export type WorkNode<T extends WorkNodeType> = Node<NodeMap[T], T>;
export type AnyWorkNode = WorkNode<"start"> | WorkNode<"end"> | WorkNode<"role">;

export type StatusEdgeData = AnyKeyBase & {
  status: string;
};

export type StatusEdge = Edge<StatusEdgeData, "status">;
export type AnyWorkEdge = StatusEdge | Edge;
