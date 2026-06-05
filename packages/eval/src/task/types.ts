/** Judge entry in task.yaml */
export type JudgeEntry = {
  name: string;
  weight: number;
  builtin: boolean;
  /** Path to judge entry script (relative to task root). Required for non-builtin judges. */
  entry: string | null;
  /** Path to OCAS schema JSON for judge data. Required for non-builtin judges. */
  schema: string | null;
};

/** Limits for eval execution. */
export type TaskLimits = {
  maxSteps: number;
  timeoutMinutes: number;
};

/** Parsed task.yaml manifest. */
export type TaskManifest = {
  name: string;
  description: string;
  /** Workflow name or relative path to .yaml file. */
  workflow: string;
  /** Initial prompt for thread start. */
  prompt: string;
  limits: TaskLimits;
  judges: JudgeEntry[];
};
