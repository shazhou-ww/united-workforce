import * as z from "zod/v4";

type ZodSchema = z.ZodType;

type DefPipeIn = { in: ZodSchema };

function hasCasRef(schema: ZodSchema): boolean {
  const meta = z.globalRegistry.get(schema);
  return meta !== undefined && meta.casRef === true;
}

function walkOptional(schema: z.ZodOptional<ZodSchema>, data: unknown): string[] {
  if (data === undefined) {
    return [];
  }
  return walkCasRefs(schema.unwrap(), data);
}

function walkNullable(schema: z.ZodNullable<ZodSchema>, data: unknown): string[] {
  if (data === null) {
    return [];
  }
  return walkCasRefs(schema.unwrap(), data);
}

function walkDefault(schema: z.ZodDefault<ZodSchema>, data: unknown): string[] {
  return walkCasRefs(schema.unwrap(), data);
}

function walkPrefault(schema: z.ZodPrefault<ZodSchema>, data: unknown): string[] {
  return walkCasRefs(schema.unwrap(), data);
}

function walkCatch(schema: z.ZodCatch<ZodSchema>, data: unknown): string[] {
  return walkCasRefs(schema.unwrap(), data);
}

function walkReadonly(schema: z.ZodReadonly<ZodSchema>, data: unknown): string[] {
  return walkCasRefs(schema.unwrap(), data);
}

function walkPipe(def: DefPipeIn, data: unknown): string[] {
  return walkCasRefs(def.in, data);
}

function walkString(schema: ZodSchema, data: unknown): string[] {
  if (hasCasRef(schema) && typeof data === "string") {
    return [data];
  }
  return [];
}

function walkObject(schema: z.ZodObject<z.ZodRawShape>, data: unknown): string[] {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return [];
  }
  const record = data as Record<string, unknown>;
  const shape = schema.shape;
  const refs: string[] = [];
  for (const [key, fieldSchema] of Object.entries(shape)) {
    refs.push(...walkCasRefs(fieldSchema as ZodSchema, record[key]));
  }
  return refs;
}

function walkArray(schema: z.ZodArray<ZodSchema>, data: unknown): string[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const element = schema.element;
  const refs: string[] = [];
  for (const item of data) {
    refs.push(...walkCasRefs(element, item));
  }
  return refs;
}

function walkUnion(schema: z.ZodUnion<readonly ZodSchema[]>, data: unknown): string[] {
  for (const option of schema.options) {
    const parsed = option.safeParse(data);
    if (parsed.success) {
      return walkCasRefs(option, data);
    }
  }
  return [];
}

function walkCasRefs(schema: ZodSchema, data: unknown): string[] {
  const def = schema.def;

  switch (def.type) {
    case "optional":
      return walkOptional(schema as z.ZodOptional<ZodSchema>, data);
    case "nullable":
      return walkNullable(schema as z.ZodNullable<ZodSchema>, data);
    case "default":
      return walkDefault(schema as z.ZodDefault<ZodSchema>, data);
    case "prefault":
      return walkPrefault(schema as z.ZodPrefault<ZodSchema>, data);
    case "catch":
      return walkCatch(schema as z.ZodCatch<ZodSchema>, data);
    case "readonly":
      return walkReadonly(schema as z.ZodReadonly<ZodSchema>, data);
    case "pipe":
      return walkPipe(def as unknown as DefPipeIn, data);
    case "string":
      return walkString(schema, data);
    case "object":
      return walkObject(schema as z.ZodObject<z.ZodRawShape>, data);
    case "array":
      return walkArray(schema as z.ZodArray<ZodSchema>, data);
    case "union":
      return walkUnion(schema as z.ZodUnion<readonly ZodSchema[]>, data);
    default:
      return [];
  }
}

/** Collect CAS content hashes from meta using `casRef` annotations on the Zod schema. */
export function collectCasRefs(schema: ZodSchema, data: unknown): string[] {
  return walkCasRefs(schema, data);
}
