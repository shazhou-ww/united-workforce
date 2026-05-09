import { useEffect, useRef, useState } from "react";
import { getThread, killThread, pauseThread, resumeThread } from "../api.ts";
import { useFetch } from "../hooks.ts";
import { useSSE } from "../use-sse.ts";

type Props = {
  threadId: string;
  onBack: () => void;
};

export function ThreadDetail({ threadId, onBack }: Props) {
  const sse = useSSE(threadId);
  const { status, data, error } = useFetch(() => getThread(threadId), [threadId]);
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
      await fn(threadId);
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
          {records.map((r) => (
            <div
              key={`${threadId}-${r.type}-${String(r.timestamp)}-${r.role ?? ""}-${r.content ?? ""}`}
              className="p-3 rounded border text-sm"
              style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-xs px-1.5 py-0.5 rounded font-mono"
                  style={{ background: "var(--color-border)", color: "var(--color-accent)" }}
                >
                  {r.type}
                </span>
                {r.role && (
                  <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    {r.role}
                  </span>
                )}
                {r.timestamp !== null && (
                  <span className="text-xs ml-auto" style={{ color: "var(--color-text-muted)" }}>
                    {new Date(r.timestamp).toLocaleTimeString()}
                  </span>
                )}
              </div>
              {r.content && (
                <pre
                  className="whitespace-pre-wrap text-xs mt-1"
                  style={{ color: "var(--color-text)" }}
                >
                  {typeof r.content === "string" ? r.content : JSON.stringify(r.content, null, 2)}
                </pre>
              )}
            </div>
          ))}
          <div ref={recordsEndRef} aria-hidden />
        </div>
      )}
    </div>
  );
}
