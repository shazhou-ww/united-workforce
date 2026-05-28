export {
  generateBootstrapReference as cmdSkillBootstrap,
  generateAdapterReference as cmdSkillAdapter,
  generateAuthorReference as cmdSkillAuthor,
  generateDeveloperReference as cmdSkillDeveloper,
  generateUserReference as cmdSkillUser,
} from "@uncaged/workflow-util";

const SKILL_NAMES = ["user", "author", "developer", "adapter", "bootstrap"] as const;

export function cmdSkillList(): ReadonlyArray<string> {
  return [...SKILL_NAMES];
}
