export type CasStore = {
  put(content: string): Promise<string>;
  get(hash: string): Promise<string | null>;
  delete(hash: string): Promise<void>;
  list(): Promise<string[]>;
};
