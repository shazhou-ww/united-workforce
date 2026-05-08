import { useState } from "react";
import { getThread, killThread, pauseThread, resumeThread } from "../api.ts";
import { useFetch } from "../hooks.ts";

type Props = {
  threadId: string;
  onBack: () => void;
};

export function ThreadDetail({ threadId, onBack }: Props) {
  const { status, data, error } = useFetch(() => getThread(threadId), [threadId]);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

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

      <h2 className="text-xl font-semibold mb-2 font-mono">{threadId}</h2>
      {actionStatus && (
        <p className="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
          {actionStatus}
        </p>
      )}

      {status === "loading" && <p style={{ color: "var(--color-text-muted)" }}>Loading...</p>}
      {status === "error" && <p style={{ color: "var(--color-error)" }}>Error: {error}</p>}
      {status === "ok" && (
        <div className="space-y-3">
          {data.records.map((r) => (
            <div
              key={`${r.type}:${r.role ?? ""}:${r.timestamp ?? 0}:${String(r.content ?? "")}`}
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
                {r.timestamp && (
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
        </div>
      )}
    </div>
  );
}
