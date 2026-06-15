/**
 * Minimal SSE parser for the Sumeru wire protocol.
 *
 * Sumeru's stream is dominated by two event types — `turn` and `done` —
 * with occasional `heartbeat` and at most one `error`. A small hand-rolled
 * parser handles this without pulling in a heavyweight library.
 *
 * Wire format (per `formatEvent` in sumeru's `server/src/sse/buffer.ts`):
 *
 *   id: <number>\nevent: <name>\ndata: <single-line-json>\n\n
 *
 * The parser supports multi-line `data:` payloads per the standard EventSource
 * spec, even though Sumeru only ever emits single-line payloads — this keeps
 * the parser resilient to future server changes.
 */

export type SseEvent = Readonly<{
  id: string | null;
  event: string;
  data: string;
}>;

type FieldValue = { field: string; value: string };

/** Parse one SSE field line `name: value`. Returns null for comment lines. */
function parseFieldLine(line: string): FieldValue | null {
  if (line === "") return null;
  if (line.startsWith(":")) {
    // Comment line — ignored per SSE spec.
    return null;
  }
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) {
    return { field: line, value: "" };
  }
  const field = line.slice(0, colonIdx);
  let value = line.slice(colonIdx + 1);
  if (value.startsWith(" ")) {
    value = value.slice(1);
  }
  return { field, value };
}

type ParsedFrame = {
  id: string | null;
  event: string;
  dataLines: string[];
};

function applyField(acc: ParsedFrame, fv: FieldValue): ParsedFrame {
  if (fv.field === "id") return { ...acc, id: fv.value };
  if (fv.field === "event") return { ...acc, event: fv.value };
  if (fv.field === "data") return { ...acc, dataLines: [...acc.dataLines, fv.value] };
  // Unknown fields ignored per SSE spec.
  return acc;
}

function parseFrame(frame: string): SseEvent | null {
  // Frame may be terminated by CRLF or LF; normalise.
  const lines = frame.split(/\r?\n/);
  let acc: ParsedFrame = { id: null, event: "message", dataLines: [] };
  for (const line of lines) {
    const fv = parseFieldLine(line);
    if (fv === null) continue;
    acc = applyField(acc, fv);
  }
  if (acc.dataLines.length === 0) {
    return null;
  }
  return { id: acc.id, event: acc.event, data: acc.dataLines.join("\n") };
}

export function createSseParser(): {
  push: (chunk: string) => SseEvent[];
  /** Drain any final partial event when the stream ends. */
  drain: () => SseEvent[];
} {
  let buffer = "";

  return {
    push(chunk) {
      buffer += chunk;
      const events: SseEvent[] = [];
      let separatorIdx = buffer.search(/\r?\n\r?\n/);
      while (separatorIdx !== -1) {
        const frame = buffer.slice(0, separatorIdx);
        // Skip past the matched separator (length is 2 for \n\n or 4 for \r\n\r\n).
        const match = /\r?\n\r?\n/.exec(buffer.slice(separatorIdx));
        const sepLen = match !== null ? match[0].length : 2;
        buffer = buffer.slice(separatorIdx + sepLen);
        const evt = parseFrame(frame);
        if (evt !== null) {
          events.push(evt);
        }
        separatorIdx = buffer.search(/\r?\n\r?\n/);
      }
      return events;
    },
    drain() {
      if (buffer.trim() === "") {
        buffer = "";
        return [];
      }
      const frame = buffer;
      buffer = "";
      const evt = parseFrame(frame);
      return evt === null ? [] : [evt];
    },
  };
}
