import { validate } from "@uncaged/json-cas";
import type { Store } from "@uncaged/json-cas";
import type { CasRef } from "@uncaged/workflow-protocol";
import { parseFrontmatterMarkdown, validateFrontmatter } from "@uncaged/workflow-util";

export type FrontmatterFastPathResult = {
  body: string;
  outputHash: CasRef;
};

/**
 * Try to satisfy `outputSchema` from frontmatter fields alone.
 *
 * Returns a result containing the stored CAS hash and stripped body on success,
 * or `null` when frontmatter is absent, invalid, or does not satisfy the schema.
 * Never throws.
 *
 * The candidate object is put into the real CAS store (idempotent content-addressed
 * write) and validated against the output schema.  If validation fails the node
 * is orphaned — it will be GC'd on the next collection pass.
 */
export async function tryFrontmatterFastPath(
  raw: string,
  outputSchema: CasRef,
  store: Store,
): Promise<FrontmatterFastPathResult | null> {
  const { frontmatter, body } = parseFrontmatterMarkdown(raw);

  if (frontmatter === null) {
    return null;
  }

  const validationErrors = validateFrontmatter(frontmatter);
  if (validationErrors.length > 0) {
    return null;
  }

  const candidate: Record<string, unknown> = {
    status: frontmatter.status,
    next: frontmatter.next,
    confidence: frontmatter.confidence,
    artifacts: [...frontmatter.artifacts],
    scope: frontmatter.scope,
  };

  let outputHash: CasRef;
  let node: ReturnType<Store["get"]>;

  try {
    outputHash = await store.put(outputSchema, candidate);
    node = store.get(outputHash);
  } catch {
    return null;
  }

  if (node === null || !validate(store, node)) {
    return null;
  }

  return { body, outputHash };
}
