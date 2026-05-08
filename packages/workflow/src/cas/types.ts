export type CasStore = {
  put(content: string): Promise<string>;
  get(hash: string): Promise<string | null>;
  delete(hash: string): Promise<void>;
  list(): Promise<string[]>;
};

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
