import { getContentMerklePayload, parseCasThreadNode } from "@uncaged/workflow-cas";
import type {
  CasStore,
  RoleMeta,
  RoleStep,
  StartNode,
  StateNode,
  ThreadContext,
} from "@uncaged/workflow-protocol";
import { END, START } from "@uncaged/workflow-protocol";

async function loadParsedNode(cas: CasStore, hash: string) {
  const yamlText = await cas.get(hash);
  if (yamlText === null) {
    return null;
  }
  return parseCasThreadNode(yamlText);
}

async function resolvePromptText(cas: CasStore, promptHash: string): Promise<string> {
  const text = await getContentMerklePayload(cas, promptHash);
  if (text !== null) {
    return text;
  }
  throw new Error(`buildThreadContext: could not resolve prompt text at ${promptHash}`);
}

async function collectStateChainFromHead(cas: CasStore, headHash: string): Promise<StateNode[]> {
  const reversed: StateNode[] = [];
  let hash: string | null = headHash;
  while (hash !== null) {
    const parsed = await loadParsedNode(cas, hash);
    if (parsed === null || parsed.kind !== "state") {
      throw new Error(`buildThreadContext: expected state node at ${hash}`);
    }
    reversed.push(parsed.node);
    const anc = parsed.node.payload.ancestors;
    hash = anc.length > 0 ? anc[0] : null;
  }
  reversed.reverse();
  return reversed;
}

async function threadFromStartHead<M extends RoleMeta>(
  node: StartNode,
  cas: CasStore,
): Promise<ThreadContext<M>> {
  const promptHash = node.refs[0];
  if (promptHash === undefined) {
    throw new Error("buildThreadContext: StartNode missing refs[0] prompt");
  }
  const prompt = await resolvePromptText(cas, promptHash);
  const p = node.payload;
  return {
    threadId: "",
    depth: p.depth,
    bundleHash: p.hash,
    start: {
      role: START,
      content: prompt,
      meta: {},
      timestamp: 0,
      parentState: p.parentState,
    },
    steps: [],
  };
}

async function buildRoleStepsFromStates<M extends RoleMeta>(
  chronologicalStates: StateNode[],
  cas: CasStore,
): Promise<RoleStep<M>[]> {
  const steps: RoleStep<M>[] = [];
  for (let idx = 0; idx < chronologicalStates.length; idx++) {
    const st = chronologicalStates[idx];
    if (st.payload.role === END) {
      continue;
    }
    const contentParsed = await loadParsedNode(cas, st.payload.content);
    if (contentParsed === null || contentParsed.kind !== "content") {
      throw new Error(`buildThreadContext: expected content node at ${st.payload.content}`);
    }
    // Resolve full text content for the last step only
    const isLast = idx === chronologicalStates.length - 1;
    steps.push({
      role: st.payload.role,
      meta: st.payload.meta,
      contentHash: st.payload.content,
      content: isLast ? contentParsed.node.payload : null,
      refs: [...contentParsed.node.refs],
      timestamp: st.payload.timestamp,
    } as RoleStep<M>);
  }
  return steps;
}

async function threadFromStateHead<M extends RoleMeta>(
  headHash: string,
  cas: CasStore,
): Promise<ThreadContext<M>> {
  const chronologicalStates = await collectStateChainFromHead(cas, headHash);
  const firstState = chronologicalStates[0];
  if (firstState === undefined) {
    throw new Error("buildThreadContext: empty state chain");
  }
  const startBlob = await loadParsedNode(cas, firstState.payload.start);
  if (startBlob === null || startBlob.kind !== "start") {
    throw new Error(`buildThreadContext: StartNode missing at ${firstState.payload.start}`);
  }
  const promptHash = startBlob.node.refs[0];
  if (promptHash === undefined) {
    throw new Error("buildThreadContext: StartNode missing refs[0] prompt");
  }
  const prompt = await resolvePromptText(cas, promptHash);
  const sp = startBlob.node.payload;
  const steps = await buildRoleStepsFromStates<M>(chronologicalStates, cas);
  const firstTs = steps[0]?.timestamp ?? 0;

  return {
    threadId: "",
    depth: sp.depth,
    bundleHash: sp.hash,
    start: {
      role: START,
      content: prompt,
      meta: {},
      timestamp: firstTs,
      parentState: sp.parentState,
    },
    steps,
  };
}

/**
 * Reconstructs {@link ThreadContext} by walking the CAS state chain from {@link headHash}.
 *
 * Walks each {@link StateNode} via `payload.ancestors[0]` until the ancestor list is empty,
 * resolves the prompt from the shared {@link StartNode} (`refs[0]` → prompt blob), and builds
 * steps from non-`__end__` states in chronological order.
 *
 * `threadId` is set to `""` — callers that load from `threads.json` should overwrite it.
 */
export async function buildThreadContext<M extends RoleMeta = RoleMeta>(
  headHash: string,
  cas: CasStore,
): Promise<ThreadContext<M>> {
  const headParsed = await loadParsedNode(cas, headHash);
  if (headParsed === null) {
    throw new Error(`buildThreadContext: missing or invalid CAS blob ${headHash}`);
  }

  if (headParsed.kind === "start") {
    return threadFromStartHead(headParsed.node, cas);
  }

  if (headParsed.kind !== "state") {
    throw new Error(`buildThreadContext: head ${headHash} must be start or state node`);
  }

  return threadFromStateHead(headHash, cas);
}
