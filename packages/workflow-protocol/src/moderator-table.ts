import type { Moderator, ModeratorTable, RoleMeta } from "./types.js";
import { END, START } from "./types.js";

export function tableToModerator<M extends RoleMeta>(
	table: ModeratorTable<M>,
): Moderator<M> {
	return (ctx) => {
		const lastStep = ctx.steps.length > 0 ? ctx.steps[ctx.steps.length - 1] : null;
		const currentRole: string = lastStep ? lastStep.role : START;

		const transitions = (table as Record<string, (typeof table)[string]>)[currentRole];
		if (!transitions) {
			return END;
		}

		for (const transition of transitions) {
			if (transition.condition === "FALLBACK" || transition.condition.check(ctx)) {
				return transition.role;
			}
		}

		return END;
	};
}
