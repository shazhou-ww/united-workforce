import type { CasStore } from "@uncaged/workflow-cas";
import { parseCasThreadNode, putContentNodeWithRefs, putStateNode } from "@uncaged/workflow-cas";
import type { StateNodePayload } from "@uncaged/workflow-protocol";
import type { RoleOutput, WorkflowCompletion } from "@uncaged/workflow-runtime";
import { END } from "@uncaged/workflow-runtime";
import { err, ok, type Result } from "@uncaged/workflow-util";
import { parse as parseYaml } from "yaml";

import { upsertThreadEntry } from "./threads-index.js";
import type { CasForkPlan, ChainState, ForkContinuationOptions } from "./types.js";
import { EMPTY_CHAIN_STATE } from "./types.js";

/** Internal branch marker; skipped when presenting fork selection / replay slices. */
export const FORK_BRANCH_ROLE = "__fork__";

/** Cap for {@link StateNodePayload}.ancestors: 1 parent + 10 skip-list. */
const ANCESTORS_CAP = 11;

function computeAncestors(chain: ChainState): string[] {
  if (chain.parentStateHash === null) {
    return [];
  }
  return [chain.parentStateHash, ...chain.parentAncestors].slice(0, ANCESTORS_CAP);
}

/** Recognizes a persisted workflow completion line (no `role`; has numeric `returnCode` and string `summary`). */
export function tryParseWorkflowResultRecord(
  obj: Record<string, unknown>,
): WorkflowCompletion | null {
  if (obj.role !== undefined) {
    return null;
  }
  const returnCode = obj.returnCode;
  const summary = obj.summary;
  if (typeof returnCode !== "number" || typeof summary !== "string") {
    return null;
  }
  return { returnCode, summary };
}

/** Walk {@link StateNode} hashes from head toward the first step (newest → oldest). */
export async function walkStateFramesNewestFirst(
  cas: CasStore,
  headHash: string,
): Promise<Array<{ hash: string; payload: StateNodePayload }>> {
  const frames: Array<{ hash: string; payload: StateNodePayload }> = [];
  let cur = headHash;
  while (true) {
    const yamlText = await cas.get(cur);
    if (yamlText === null) {
      break;
    }
    const parsed = parseCasThreadNode(yamlText);
    if (parsed === null || parsed.kind !== "state") {
      break;
    }
    frames.push({ hash: cur, payload: parsed.node.payload });
    const ancestors = parsed.node.payload.ancestors;
    if (ancestors.length === 0) {
      break;
    }
    const parent = ancestors[0];
    if (parent === undefined || parent === "") {
      break;
    }
    cur = parent;
  }
  return frames;
}

function orderedUniqueRoles(roles: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of roles) {
    if (!seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

async function readPromptText(cas: CasStore, promptHash: string): Promise<Result<string, string>> {
  const yamlText = await cas.get(promptHash);
  if (yamlText === null) {
    return err(`prompt CAS blob missing: ${promptHash}`);
  }
  let raw: unknown;
  try {
    raw = parseYaml(yamlText) as unknown;
  } catch {
    return err(`prompt CAS blob is not valid YAML: ${promptHash}`);
  }
  if (raw === null || typeof raw !== "object") {
    return err(`prompt CAS blob has unexpected shape: ${promptHash}`);
  }
  const payload = (raw as Record<string, unknown>).payload;
  if (typeof payload !== "string") {
    return err(`prompt CAS blob missing string payload: ${promptHash}`);
  }
  return ok(payload);
}

async function readStartWorkflowIdentity(params: {
  cas: CasStore;
  startHash: string;
}): Promise<Result<{ workflowName: string; depth: number; prompt: string }, string>> {
  const yamlText = await params.cas.get(params.startHash);
  if (yamlText === null) {
    return err(`start node missing in CAS: ${params.startHash}`);
  }
  const parsed = parseCasThreadNode(yamlText);
  if (parsed === null || parsed.kind !== "start") {
    return err(`CAS blob is not a StartNode: ${params.startHash}`);
  }
  const refs = parsed.node.refs;
  const promptHash = refs[0];
  if (typeof promptHash !== "string") {
    return err("StartNode refs[0] must be the prompt hash");
  }
  const prompt = await readPromptText(params.cas, promptHash);
  if (!prompt.ok) {
    return prompt;
  }
  const p = parsed.node.payload;
  return ok({
    workflowName: p.name,
    depth: p.depth,
    prompt: prompt.value,
  });
}

async function payloadToRoleOutput(cas: CasStore, payload: StateNodePayload): Promise<RoleOutput> {
  let refs: string[] = [];
  const blob = await cas.get(payload.content);
  if (blob !== null) {
    const cn = parseCasThreadNode(blob);
    if (cn?.kind === "content") {
      refs = [...cn.node.refs];
    }
  }
  return {
    role: payload.role,
    contentHash: payload.content,
    meta: payload.meta,
    refs,
  };
}

function meaningfulFramesOldestFirst(
  newestFirst: Array<{ hash: string; payload: StateNodePayload }>,
): Array<{ hash: string; payload: StateNodePayload }> {
  const chronological = [...newestFirst].reverse();
  return chronological.filter((f) => f.payload.role !== END && f.payload.role !== FORK_BRANCH_ROLE);
}

function selectForkPointStateHash(
  meaningfulOldestFirst: Array<{ hash: string; payload: StateNodePayload }>,
  fromRole: string | null,
): Result<string | null, string> {
  if (meaningfulOldestFirst.length === 0) {
    return err("thread has no completed role steps to fork from");
  }

  if (fromRole === null) {
    if (meaningfulOldestFirst.length === 1) {
      return ok(null);
    }
    const forkFrame = meaningfulOldestFirst[meaningfulOldestFirst.length - 2];
    if (forkFrame === undefined) {
      return err("thread has no completed role steps to fork from");
    }
    return ok(forkFrame.hash);
  }

  const idx = meaningfulOldestFirst.findIndex((f) => f.payload.role === fromRole);
  if (idx < 0) {
    const available = orderedUniqueRoles(meaningfulOldestFirst.map((f) => f.payload.role));
    return err(`role not found in thread: ${fromRole} (available: ${available.join(", ")})`);
  }
  const forkFrame = meaningfulOldestFirst[idx];
  if (forkFrame === undefined) {
    return err("fork frame missing");
  }
  return ok(forkFrame.hash);
}

function replayFramesThroughForkPoint(
  meaningfulOldestFirst: Array<{ hash: string; payload: StateNodePayload }>,
  forkPointHash: string | null,
): Array<{ hash: string; payload: StateNodePayload }> {
  if (forkPointHash === null) {
    return [];
  }
  const idx = meaningfulOldestFirst.findIndex((f) => f.hash === forkPointHash);
  if (idx < 0) {
    return [];
  }
  return meaningfulOldestFirst.slice(0, idx + 1);
}

async function buildForkContinuation(params: {
  cas: CasStore;
  sourceThreadId: string;
  startHash: string;
  forkPointStateHash: string | null;
}): Promise<Result<ForkContinuationOptions, string>> {
  const { cas, sourceThreadId, startHash, forkPointStateHash } = params;

  if (forkPointStateHash === null) {
    return ok({
      startHash,
      forkHeadHash: startHash,
      initialChain: EMPTY_CHAIN_STATE,
    });
  }

  const yamlText = await cas.get(forkPointStateHash);
  if (yamlText === null) {
    return err(`fork point state missing in CAS: ${forkPointStateHash}`);
  }
  const parsed = parseCasThreadNode(yamlText);
  if (parsed === null || parsed.kind !== "state") {
    return err(`fork point blob is not a StateNode: ${forkPointStateHash}`);
  }
  const fpPayload = parsed.node.payload;

  const chainBefore: ChainState = {
    parentStateHash: forkPointStateHash,
    parentAncestors: fpPayload.ancestors,
  };
  const ancestorsMarker = computeAncestors(chainBefore);

  const emptyContentHash = await putContentNodeWithRefs(cas, "", []);
  const markerPayload: StateNodePayload = {
    role: FORK_BRANCH_ROLE,
    meta: { forkFrom: sourceThreadId },
    start: startHash,
    content: emptyContentHash,
    ancestors: ancestorsMarker,
    compact: null,
    timestamp: Date.now(),
  };
  const markerHash = await putStateNode(cas, markerPayload);

  const initialChain: ChainState = {
    parentStateHash: markerHash,
    parentAncestors: ancestorsMarker,
  };

  return ok({
    startHash,
    forkHeadHash: markerHash,
    initialChain,
  });
}

/**
 * Prepare a CAS fork: writes the branch marker {@link StateNode}, registers `threads.json`,
 * and returns worker payload fields (shared {@link StartNode}, zero ancestor duplication).
 */
export async function prepareCasFork(params: {
  cas: CasStore;
  bundleDir: string;
  bundleHash: string;
  sourceThreadId: string;
  headHash: string;
  startHash: string;
  newThreadId: string;
  fromRole: string | null;
}): Promise<Result<CasForkPlan, string>> {
  const id = await readStartWorkflowIdentity({
    cas: params.cas,
    startHash: params.startHash,
  });
  if (!id.ok) {
    return id;
  }

  const newestFirst = await walkStateFramesNewestFirst(params.cas, params.headHash);
  const meaningful = meaningfulFramesOldestFirst(newestFirst);

  const forkPoint = selectForkPointStateHash(meaningful, params.fromRole);
  if (!forkPoint.ok) {
    return forkPoint;
  }

  const replayFrames = replayFramesThroughForkPoint(meaningful, forkPoint.value);
  const steps: RoleOutput[] = [];
  const stepTimestamps: number[] = [];
  for (const fr of replayFrames) {
    steps.push(await payloadToRoleOutput(params.cas, fr.payload));
    stepTimestamps.push(fr.payload.timestamp);
  }

  const cont = await buildForkContinuation({
    cas: params.cas,
    sourceThreadId: params.sourceThreadId,
    startHash: params.startHash,
    forkPointStateHash: forkPoint.value,
  });
  if (!cont.ok) {
    return cont;
  }

  await upsertThreadEntry(params.bundleDir, params.newThreadId, {
    head: cont.value.forkHeadHash,
    start: params.startHash,
    updatedAt: Date.now(),
  });

  return ok({
    workflowName: id.value.workflowName,
    hash: params.bundleHash,
    sourceThreadId: params.sourceThreadId,
    prompt: id.value.prompt,
    runOptions: { depth: id.value.depth },
    steps,
    stepTimestamps,
    forkContinuation: cont.value,
  });
}
