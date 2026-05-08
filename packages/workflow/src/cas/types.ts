export type { CasStore } from "@uncaged/workflow-runtime";

export type MerkleNodeType = "content" | "step" | "thread";

export type MerkleNode = {
  type: MerkleNodeType;
  payload: string | Record<string, unknown>;
  children: string[];
};

export type StepMerklePayload = {
  role: string;
  meta: Record<string, unknown>;
};

export type ThreadMerklePayload = {
  workflow: string;
  threadId: string;
  result: {
    returnCode: number;
    summary: string;
  };
};
