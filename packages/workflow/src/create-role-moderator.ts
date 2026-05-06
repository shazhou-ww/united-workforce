import {
  END,
  type RoleMeta,
  type RoleOutput,
  type RoleStep,
  START,
  type ThreadContext,
  type ThreadInput,
  type WorkflowDefinition,
  type WorkflowFn,
  type WorkflowFnOptions,
  type WorkflowResult,
} from "./types.js";

function isRoleNext<M extends RoleMeta>(
  next: (keyof M & string) | typeof END,
): next is keyof M & string {
  return next !== END;
}

/**
 * Role + Moderator pattern as an optional helper: returns a {@link WorkflowFn} that runs the
 * moderator loop and yields each {@link RoleOutput}. Assign with `export const run = createRoleModerator(...)`.
 */
export function createRoleModerator<M extends RoleMeta>(
  def: Pick<WorkflowDefinition<M>, "roles" | "moderator">,
): WorkflowFn {
  return async function* roleModeratorWorkflow(
    input: ThreadInput,
    options: WorkflowFnOptions,
  ): AsyncGenerator<RoleOutput, WorkflowResult> {
    const nowMs = Date.now();
    const start: ThreadContext<M>["start"] = {
      role: START,
      content: input.prompt,
      meta: { maxRounds: options.maxRounds },
      timestamp: nowMs,
    };

    const baseTs = Date.now();
    let steps: RoleStep<M>[] = input.steps.map((out, i) => ({
      role: out.role,
      content: out.content,
      meta: out.meta,
      timestamp: baseTs + i,
    })) as RoleStep<M>[];

    while (true) {
      if (steps.length >= options.maxRounds) {
        return {
          returnCode: 0,
          summary: `completed: reached maxRounds (${options.maxRounds})`,
        };
      }

      const ctx: ThreadContext<M> = {
        threadId: options.threadId,
        start,
        steps,
      };

      const next = def.moderator(ctx);

      if (!isRoleNext(next)) {
        return { returnCode: 0, summary: "completed: moderator returned END" };
      }

      const roleFn = def.roles[next];
      if (roleFn === undefined) {
        return { returnCode: 1, summary: `unknown role: ${next}` };
      }

      const result = await roleFn(ctx as unknown as ThreadContext);
      const ts = Date.now();
      const step = {
        role: next,
        content: result.content,
        meta: result.meta,
        timestamp: ts,
      } as RoleStep<M>;

      yield {
        role: step.role,
        content: step.content,
        meta: step.meta,
      };

      steps = [...steps, step];
    }
  };
}
