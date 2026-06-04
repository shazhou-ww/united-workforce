/** One pre-scripted step in a mock scenario. */
export type MockStep = {
  /** Role this step is expected to run as. Validated against the actual `--role` argument. */
  role: string;
  /** Frontmatter markdown output the mock agent emits for this step. */
  output: string;
};

/** Deterministic, pre-scripted agent script loaded from a YAML mock data file. */
export type MockScenario = {
  steps: MockStep[];
};
