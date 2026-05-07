import type { RoleDefinition } from "@uncaged/workflow";
import { type DeveloperMeta, developerRole } from "./developer.js";
import { type PreparerMeta, preparerRole } from "./roles/preparer.js";
import { type SubmitterMeta, submitterRole } from "./roles/submitter.js";

export const SOLVE_ISSUE_WORKFLOW_DESCRIPTION =
  "Resolve an issue end-to-end by preparing the repo, delegating implementation to the develop workflow, and opening a pull request (preparer → developer → submitter).";

export type SolveIssueMeta = {
  preparer: PreparerMeta;
  developer: DeveloperMeta;
  submitter: SubmitterMeta;
};

export type SolveIssueRoles = {
  [K in keyof SolveIssueMeta]: RoleDefinition<SolveIssueMeta[K]>;
};

export const solveIssueRoles: SolveIssueRoles = {
  preparer: preparerRole,
  developer: developerRole,
  submitter: submitterRole,
};
