import { err, ok, type Result } from "@uncaged/workflow-protocol";

const WORKFLOW_NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function validateCliWorkflowName(name: string): Result<void, string> {
  if (!WORKFLOW_NAME_RE.test(name)) {
    return err(
      'invalid workflow name: use verb-first kebab-case (lowercase letters, digits, hyphens), e.g. "solve-issue"',
    );
  }
  return ok(undefined);
}
