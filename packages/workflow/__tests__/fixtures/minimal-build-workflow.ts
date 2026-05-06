import { createRoleModerator } from "../../src/create-role-moderator.js";
import { END, type Role } from "../../src/types.js";

type RMeta = { x: string };

export const descriptor = {
  description: "minimal fixture workflow for build-pipeline tests",
  roles: {
    r: {
      description: "single role",
      schema: {
        type: "object",
        properties: { x: { type: "string" } },
        required: ["x"],
      },
    },
  },
};

const r: Role<RMeta> = async () => ({
  content: "",
  meta: { x: "y" },
});

export default createRoleModerator({
  roles: { r },
  moderator() {
    return END;
  },
});
