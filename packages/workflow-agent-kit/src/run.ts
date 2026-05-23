import { getSchema, validate } from "@uncaged/json-cas";
import type { CasRef, StepNodePayload, ThreadId } from "@uncaged/workflow-protocol";
import { config as loadDotenv } from "dotenv";
import { buildOutputFormatInstruction } from "./build-output-format-instruction.js";
import { buildContextWithMeta } from "./context.js";
import { tryFrontmatterFastPath } from "./frontmatter.js";
import type { AgentStore } from "./storage.js";
import { getEnvPath, resolveStorageRoot } from "./storage.js";
import type { AgentOptions } from "./types.js";

const MAX_FRONTMATTER_RETRIES = 2;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function agentLabel(name: string): string {
  if (name.startsWith("uwf-")) {
    return name;
  }
  return `uwf-${name}`;
}

function parseArgv(argv: string[]): { threadId: ThreadId; role: string } {
  const threadId = argv[2];
  const role = argv[3];
  if (threadId === undefined || threadId === "") {
    fail("usage: <agent-cli> <thread-id> <role>");
  }
  if (role === undefined || role === "") {
    fail("usage: <agent-cli> <thread-id> <role>");
  }
  return { threadId: threadId as ThreadId, role };
}

function runWithMessage<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return fn().catch((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    fail(`${label}: ${message}`);
  });
}

async function writeStepNode(options: {
  store: AgentStore["store"];
  schemas: AgentStore["schemas"];
  startHash: CasRef;
  prevHash: CasRef | null;
  role: string;
  outputHash: CasRef;
  detailHash: CasRef;
  agentName: string;
  edgePrompt: string;
}): Promise<CasRef> {
  const payload: StepNodePayload = {
    start: options.startHash,
    prev: options.prevHash,
    role: options.role,
    output: options.outputHash,
    detail: options.detailHash,
    agent: options.agentName,
    edgePrompt: options.edgePrompt,
  };
  const hash = await options.store.put(options.schemas.stepNode, payload);
  const node = options.store.get(hash);
  if (node === null || !validate(options.store, node)) {
    fail("stored StepNode failed schema validation");
  }
  return hash;
}

async function tryExtractOutput(
  rawOutput: string,
  outputSchema: CasRef,
  ctx: Awaited<ReturnType<typeof buildContextWithMeta>>,
): Promise<CasRef | null> {
  const fastPath = await tryFrontmatterFastPath(rawOutput, outputSchema, ctx.meta.store);
  if (fastPath !== null) {
    return fastPath.outputHash;
  }
  return null;
}

async function persistStep(options: {
  ctx: Awaited<ReturnType<typeof buildContextWithMeta>>;
  outputHash: CasRef;
  detailHash: CasRef;
  agentName: string;
}): Promise<CasRef> {
  const { store, schemas, chain, headHash } = options.ctx.meta;
  return writeStepNode({
    store,
    schemas,
    startHash: chain.startHash,
    prevHash: chain.headIsStart ? null : headHash,
    role: options.ctx.role,
    outputHash: options.outputHash,
    detailHash: options.detailHash,
    agentName: options.agentName,
    edgePrompt: options.ctx.edgePrompt,
  });
}

export function createAgent(options: AgentOptions): () => Promise<void> {
  return async function main(): Promise<void> {
    const { threadId, role } = parseArgv(process.argv);
    const storageRoot = resolveStorageRoot();
    loadDotenv({ path: getEnvPath(storageRoot) });

    const ctx = await runWithMessage("context", () => buildContextWithMeta(threadId, role));

    const roleDef = ctx.workflow.roles[role];
    if (roleDef === undefined) {
      fail(`unknown role: ${role}`);
    }

    const frontmatterSchema = getSchema(ctx.meta.store, roleDef.frontmatter);
    if (frontmatterSchema !== null) {
      ctx.outputFormatInstruction = buildOutputFormatInstruction(frontmatterSchema);
    }

    let agentResult = await runWithMessage("agent run failed", () => options.run(ctx));

    // Preserve the primary detail from the first run — it contains the full
    // tool-call turn history.  Continuation retries only fix frontmatter
    // formatting and their 1-turn detail is not meaningful.
    const primaryDetailHash = agentResult.detailHash;

    // Try to extract frontmatter; retry via continue if it fails
    let outputHash = await tryExtractOutput(agentResult.output, roleDef.frontmatter, ctx);

    for (let retry = 0; retry < MAX_FRONTMATTER_RETRIES && outputHash === null; retry++) {
      const correctionMessage =
        "Your previous response did not contain valid YAML frontmatter matching the role schema.\n" +
        "You MUST begin your response with a YAML frontmatter block (--- delimited).\n" +
        "Please output ONLY the corrected frontmatter block followed by your work.";

      agentResult = await runWithMessage("agent continue failed", () =>
        options.continue(agentResult.sessionId, correctionMessage, ctx.meta.store),
      );
      outputHash = await tryExtractOutput(agentResult.output, roleDef.frontmatter, ctx);
    }

    if (outputHash === null) {
      fail(
        "Agent output does not contain valid YAML frontmatter matching the role schema " +
          `after ${MAX_FRONTMATTER_RETRIES} retries.\n` +
          `Raw output (first 500 chars): ${agentResult.output.slice(0, 500)}`,
      );
    }

    const stepHash = await persistStep({
      ctx,
      outputHash,
      detailHash: primaryDetailHash,
      agentName: agentLabel(options.name),
    });

    process.stdout.write(`${stepHash}\n`);
  };
}
