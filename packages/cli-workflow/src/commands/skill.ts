export {
  generateActorReference as cmdSkillActor,
  generateAdapterReference as cmdSkillAdapter,
  generateArchitectureReference as cmdSkillArchitecture,
  generateAuthorReference as cmdSkillAuthor,
  generateCliReference as cmdSkillCli,
  generateDeveloperReference as cmdSkillDeveloper,
  generateModeratorReference as cmdSkillModerator,
  generateUserReference as cmdSkillUser,
  generateYamlReference as cmdSkillYaml,
} from "@uncaged/workflow-util";

const SKILL_NAMES = [
  "cli",
  "architecture",
  "yaml",
  "moderator",
  "actor",
  "user",
  "author",
  "developer",
  "adapter",
] as const;

export function cmdSkillList(): ReadonlyArray<string> {
  return [...SKILL_NAMES];
}
