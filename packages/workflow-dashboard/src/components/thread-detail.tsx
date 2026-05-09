import { useEffect, useRef, useState } from "react";
import { getThread, killThread, pauseThread, resumeThread } from "../api.ts";
import { useFetch } from "../hooks.ts";
import { useSSE } from "../use-sse.ts";
import { RecordCard } from "./record-card.tsx";

type Props = {
  agent: string;
  threadId: string;
  onBack: () => void;
};

export function ThreadDetail({ agent, threadId, onBack }: Props) {
  const sse = useSSE(agent, threadId);
  const { status, data, error } = useFetch(() => getThread(agent, threadId), [agent, threadId]);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const recordsEndRef = useRef<HTMLDivElement>(null);

  const liveActive = sse.connected && !sse.completed;
  const records = liveActive
    ? sse.records
    : status === "ok"
      ? data.records
      : ([] as typeof sse.records);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the rendered record list grows
  useEffect(() => {
    recordsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [records.length]);

  async function handleAction(action: "kill" | "pause" | "resume") {
    setActionStatus(`${action}ing...`);
    try {
      const fn = action === "kill" ? killThread : action === "pause" ? pauseThread : resumeThread;
      await fn(agent, threadId);
      setActionStatus(`${action} sent ✓`);
    } catch (e) {
      setActionStatus(`${action} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={onBack}
          className="text-sm hover:underline"
          style={{ color: "var(--color-accent)" }}
        >
          ← Back to threads
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handleAction("pause")}
            className="px-3 py-1 text-xs rounded border"
            style={{ borderColor: "var(--color-warning)", color: "var(--color-warning)" }}
          >
            ⏸ Pause
          </button>
          <button
            type="button"
            onClick={() => handleAction("resume")}
            className="px-3 py-1 text-xs rounded border"
            style={{ borderColor: "var(--color-success)", color: "var(--color-success)" }}
          >
            ▶ Resume
          </button>
          <button
            type="button"
            onClick={() => handleAction("kill")}
            className="px-3 py-1 text-xs rounded border"
            style={{ borderColor: "var(--color-error)", color: "var(--color-error)" }}
          >
            ✕ Kill
          </button>
        </div>
      </div>

      <h2 className="text-xl font-semibold mb-2 font-mono flex items-center gap-2 flex-wrap">
        <span>{threadId}</span>
        {sse.connected && (
          <span
            className="text-xs font-medium px-2 py-0.5 rounded"
            style={{ background: "var(--color-success)", color: "var(--color-bg)" }}
          >
            Live
          </span>
        )}
      </h2>
      {actionStatus && (
        <p className="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
          {actionStatus}
        </p>
      )}

      {status === "loading" && !liveActive && records.length === 0 && (
        <p style={{ color: "var(--color-text-muted)" }}>Loading...</p>
      )}
      {status === "error" && !liveActive && (
        <p style={{ color: "var(--color-error)" }}>Error: {error}</p>
      )}
      {(status === "ok" || liveActive || records.length > 0) && (
        <div className="space-y-3">
          {records.map((r, i) => (
            <RecordCard key={`${threadId}-${i}`} record={r} />
          ))}
          <div ref={recordsEndRef} aria-hidden />
        </div>
      )}
    </div>
  );
}
