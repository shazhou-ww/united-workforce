import type * as z from "zod/v4";

type ZodTypeAny = z.ZodType;

type Def = Record<string, unknown> & { type: string };
type TypeHandler = (schema: ZodTypeAny, def: Def) => unknown;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isZodExactOptional(s: ZodTypeAny): boolean {
  return s.constructor.name === "ZodExactOptional";
}

function resolveDefaultValue(defaultValue: unknown | (() => unknown)): unknown {
  if (typeof defaultValue === "function") {
    return (defaultValue as () => unknown)();
  }
  return defaultValue;
}

function mergeIntersection(left: unknown, right: unknown): unknown {
  if (isPlainObject(left) && isPlainObject(right)) {
    return { ...left, ...right };
  }
  return right;
}

function defaultsForObject(_schema: ZodTypeAny, def: Def): unknown {
  const shape = def.shape as Record<string, ZodTypeAny> | undefined;
  if (shape === undefined) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) {
    const child = shape[key];
    const cdef = child.def as { type: string };
    if (cdef.type === "optional") {
      if (isZodExactOptional(child)) {
        continue;
      }
      out[key] = undefined;
    } else {
      out[key] = schemaDefaultsInner(child);
    }
  }
  return out;
}

function firstUnionOption(_schema: ZodTypeAny, def: Def): unknown {
  const options = def.options as readonly ZodTypeAny[] | undefined;
  if (options === undefined || options.length === 0) {
    return null;
  }
  return schemaDefaultsInner(options[0]);
}

function defaultsFromNullable(_schema: ZodTypeAny, _def: Def): unknown {
  return null;
}

function defaultsFromInner(_schema: ZodTypeAny, def: Def): unknown {
  const inner = def.innerType as ZodTypeAny | undefined;
  if (inner === undefined) {
    return null;
  }
  return schemaDefaultsInner(inner);
}

function defaultsForPipe(_schema: ZodTypeAny, def: Def): unknown {
  const out = def.out as ZodTypeAny | undefined;
  if (out === undefined) {
    return null;
  }
  return schemaDefaultsInner(out);
}

function defaultsForIntersection(_schema: ZodTypeAny, def: Def): unknown {
  const left = def.left as ZodTypeAny | undefined;
  const right = def.right as ZodTypeAny | undefined;
  if (left === undefined || right === undefined) {
    return null;
  }
  return mergeIntersection(schemaDefaultsInner(left), schemaDefaultsInner(right));
}

function defaultsForTuple(_schema: ZodTypeAny, def: Def): unknown {
  const items = def.items as readonly ZodTypeAny[] | undefined;
  if (items === undefined) {
    return [];
  }
  return items.map((item) => schemaDefaultsInner(item));
}

function defaultsForLazy(schema: ZodTypeAny, def: Def): unknown {
  const inner =
    (schema as { _zod?: { innerType?: ZodTypeAny } })._zod?.innerType ??
    (def.getter as (() => ZodTypeAny) | undefined)?.();
  if (inner === undefined) {
    return null;
  }
  return schemaDefaultsInner(inner);
}

function defaultsForPromise(_schema: ZodTypeAny, def: Def): unknown {
  const inner = def.innerType as ZodTypeAny | undefined;
  if (inner === undefined) {
    return Promise.resolve(null);
  }
  return Promise.resolve(schemaDefaultsInner(inner));
}

function firstEnumValue(_schema: ZodTypeAny, def: Def): unknown {
  const entries = def.entries as Record<string, string | number> | undefined;
  if (entries === undefined) {
    return null;
  }
  const values = Object.values(entries);
  return values[0] ?? null;
}

function firstLiteralValue(_schema: ZodTypeAny, def: Def): unknown {
  const values = def.values as unknown[] | undefined;
  if (values === undefined || values.length === 0) {
    return null;
  }
  return values[0];
}

const TYPE_HANDLERS: Record<string, TypeHandler> = {
  string: () => "",
  number: () => 0,
  boolean: () => false,
  bigint: () => 0n,
  date: () => new Date(0),
  symbol: () => Symbol(),
  undefined: () => undefined,
  null: () => null,
  void: () => undefined,
  any: () => null,
  unknown: () => null,
  never: () => undefined,
  nan: () => Number.NaN,
  array: () => [],
  object: defaultsForObject,
  record: () => ({}),
  map: () => new Map(),
  set: () => new Set(),
  enum: firstEnumValue,
  literal: firstLiteralValue,
  optional: () => undefined,
  nullable: defaultsFromNullable,
  default: (_s, def) => resolveDefaultValue(def.defaultValue as unknown | (() => unknown)),
  prefault: (_s, def) => resolveDefaultValue(def.defaultValue as unknown | (() => unknown)),
  nonoptional: defaultsFromInner,
  catch: defaultsFromInner,
  success: () => false,
  readonly: defaultsFromInner,
  union: firstUnionOption,
  xor: firstUnionOption,
  intersection: defaultsForIntersection,
  pipe: defaultsForPipe,
  transform: () => null,
  tuple: defaultsForTuple,
  lazy: defaultsForLazy,
  promise: defaultsForPromise,
  file: () => new File([], ""),
  function: () => null,
  custom: () => null,
  template_literal: () => "",
};

/**
 * Produces a structurally valid placeholder that mirrors primitive/array/object
 * shape for a Zod schema. Used for `llmExtract` dry runs so downstream code
 * does not throw on `undefined` fields.
 */
export function schemaDefaults(schema: z.ZodType): unknown {
  return schemaDefaultsInner(schema as ZodTypeAny);
}

function schemaDefaultsInner(schema: ZodTypeAny): unknown {
  const def = schema.def as Def;
  const run = TYPE_HANDLERS[def.type];
  if (run === undefined) {
    return null;
  }
  return run(schema, def);
}
