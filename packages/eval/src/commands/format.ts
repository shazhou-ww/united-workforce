import type { EvalRunPayload } from "../storage/index.js";
import type { EvalListEntry } from "./types.js";

const NAME_WIDTH = 28;
const SCORE_WIDTH = 10;
const TIMESTAMP_WIDTH = 26;

/** Format a 0..1 score (or weight) with fixed precision. */
function formatScore(value: number): string {
  return value.toFixed(4);
}

/** Human-readable ISO-8601 timestamp from epoch milliseconds. */
function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}

/** Right-pad to a fixed column width (with a trailing space if already full). */
function pad(value: string, width: number): string {
  return value.length >= width ? `${value} ` : value.padEnd(width);
}

/** Directional indicator for a score delta (B relative to A). */
function formatDelta(delta: number): string {
  if (delta > 0) {
    return `▲ +${formatScore(delta)}`;
  }
  if (delta < 0) {
    return `▼ ${formatScore(delta)}`;
  }
  return `= ${formatScore(0)}`;
}

/** Render a single eval run as a human-readable report. */
export function formatReport(payload: EvalRunPayload, runHash: string): string {
  const lines: string[] = [];
  lines.push("=== Eval Report ===");
  lines.push(`Task:       ${payload.task}`);
  lines.push(`Overall:    ${formatScore(payload.overall)}`);
  lines.push(`Timestamp:  ${formatTimestamp(payload.timestamp)}`);
  lines.push("");
  lines.push("Config:");
  lines.push(`  Agent:    ${payload.config.agent}`);
  lines.push(`  Model:    ${payload.config.model}`);
  lines.push(`  Engine:   ${payload.config.engineVersion}`);
  lines.push("");
  lines.push("Judges:");
  lines.push(`  ${pad("NAME", NAME_WIDTH)}${pad("SCORE", SCORE_WIDTH)}WEIGHT`);
  for (const judge of payload.judges) {
    lines.push(
      `  ${pad(judge.name, NAME_WIDTH)}${pad(formatScore(judge.score), SCORE_WIDTH)}${formatScore(judge.weight)}`,
    );
  }
  lines.push("");
  lines.push(`Thread:     ${payload.threadId}`);
  lines.push(`Run:        ${runHash}`);
  return `${lines.join("\n")}\n`;
}

/** Render a side-by-side comparison of two eval runs. */
export function formatDiff(
  payloadA: EvalRunPayload,
  hashA: string,
  payloadB: EvalRunPayload,
  hashB: string,
): string {
  const lines: string[] = [];
  lines.push("=== Eval Diff ===");
  lines.push(`A: ${hashA}  (${payloadA.task})`);
  lines.push(`B: ${hashB}  (${payloadB.task})`);
  lines.push("");

  const overallDelta = payloadB.overall - payloadA.overall;
  lines.push("Overall:");
  lines.push(
    `  A=${formatScore(payloadA.overall)}  B=${formatScore(payloadB.overall)}  ${formatDelta(overallDelta)}`,
  );
  lines.push("");

  lines.push("Config:");
  lines.push(configLine("Agent", payloadA.config.agent, payloadB.config.agent));
  lines.push(configLine("Model", payloadA.config.model, payloadB.config.model));
  lines.push(configLine("Engine", payloadA.config.engineVersion, payloadB.config.engineVersion));
  lines.push("");

  lines.push("Judges:");
  lines.push(`  ${pad("NAME", NAME_WIDTH)}${pad("A", SCORE_WIDTH)}${pad("B", SCORE_WIDTH)}DELTA`);
  const scoresA = new Map(payloadA.judges.map((judge) => [judge.name, judge.score]));
  const scoresB = new Map(payloadB.judges.map((judge) => [judge.name, judge.score]));
  for (const name of unionJudgeNames(payloadA, payloadB)) {
    const scoreA = scoresA.get(name);
    const scoreB = scoresB.get(name);
    const cellA = scoreA === undefined ? "—" : formatScore(scoreA);
    const cellB = scoreB === undefined ? "—" : formatScore(scoreB);
    const delta = scoreA !== undefined && scoreB !== undefined ? formatDelta(scoreB - scoreA) : "";
    lines.push(
      `  ${pad(name, NAME_WIDTH)}${pad(cellA, SCORE_WIDTH)}${pad(cellB, SCORE_WIDTH)}${delta}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Render a table of indexed eval runs. */
export function formatList(entries: ReadonlyArray<EvalListEntry>): string {
  const lines: string[] = [];
  lines.push(
    `  ${pad("TASK", NAME_WIDTH)}${pad("OVERALL", SCORE_WIDTH)}${pad("TIMESTAMP", TIMESTAMP_WIDTH)}HASH`,
  );
  if (entries.length === 0) {
    lines.push("  (no eval runs found)");
  }
  for (const entry of entries) {
    lines.push(
      `  ${pad(entry.task, NAME_WIDTH)}${pad(formatScore(entry.overall), SCORE_WIDTH)}${pad(formatTimestamp(entry.timestamp), TIMESTAMP_WIDTH)}${entry.hash}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Sort newest-first, then apply optional task filter and result limit. */
export function selectEntries(
  entries: ReadonlyArray<EvalListEntry>,
  task: string | null,
  limit: number | null,
): EvalListEntry[] {
  const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
  const filtered = task !== null ? sorted.filter((entry) => entry.task === task) : sorted;
  return limit !== null ? filtered.slice(0, limit) : filtered;
}

/** Ordered union of judge names: A's order first, then B-only names. */
function unionJudgeNames(payloadA: EvalRunPayload, payloadB: EvalRunPayload): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const judge of [...payloadA.judges, ...payloadB.judges]) {
    if (!seen.has(judge.name)) {
      seen.add(judge.name);
      names.push(judge.name);
    }
  }
  return names;
}

/** One config row: `=` when equal, `≠` otherwise. */
function configLine(label: string, valueA: string, valueB: string): string {
  const marker = valueA === valueB ? "=" : "≠";
  return `  ${pad(`${label}:`, SCORE_WIDTH)}${marker} A=${valueA}  B=${valueB}`;
}
