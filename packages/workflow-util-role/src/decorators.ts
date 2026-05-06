import type { Role, ThreadContext } from "@uncaged/workflow";

/** A role decorator: takes a role, returns an enhanced role. */
export type RoleDecorator<M extends Record<string, unknown>> = (role: Role<M>) => Role<M>;

/**
 * Apply an ordered list of decorators to a role.
 * Decorators are applied left-to-right (first in list wraps innermost).
 */
export function decorateRole<M extends Record<string, unknown>>(
  role: Role<M>,
  decorators: RoleDecorator<M>[],
): Role<M> {
  return decorators.reduce((r, dec) => dec(r), role);
}

export type WithDryRunOptions<M extends Record<string, unknown>> = {
  /** Used in skip message (e.g. "committer", "publish"). */
  label: string;
  /** Meta returned when dry-run skips execution. */
  meta: M;
  /** Adapter-level dry-run flag (e.g. from extract / wiring config). */
  dryRun: boolean;
};

/** Short-circuits with a stable result when `dryRun` is true. */
export function withDryRun<M extends Record<string, unknown>>(
  opts: WithDryRunOptions<M>,
): RoleDecorator<M> {
  return (role) => async (ctx: ThreadContext) => {
    if (opts.dryRun) {
      return {
        content: `[dry-run] ${opts.label} skipped`,
        meta: opts.meta,
      };
    }
    return role(ctx);
  };
}

export type OnFailOptions<M extends Record<string, unknown>> = {
  /** Used in failure message (e.g. "committer", "publish"). */
  label: string;
  /** Meta returned when the inner role throws. */
  meta: M;
};

/** Catches thrown errors and converts them into a structured {@link Role} result instead of propagating. */
export function onFail<M extends Record<string, unknown>>(
  opts: OnFailOptions<M>,
): RoleDecorator<M> {
  return (role) => async (ctx: ThreadContext) => {
    try {
      return await role(ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: `${opts.label} failed: ${msg}`,
        meta: opts.meta,
      };
    }
  };
}
