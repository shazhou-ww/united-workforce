import { getThread } from "../api.ts";
import { useFetch } from "../hooks.ts";

type Props = {
  threadId: string;
  onBack: () => void;
};

export function ThreadDetail({ threadId, onBack }: Props) {
  const { status, data, error } = useFetch(() => getThread(threadId), [threadId]);

  return (
    <div>
      <button
        onClick={onBack}
        className="text-sm mb-4 hover:underline"
        style={{ color: "var(--color-accent)" }}
      >
        ← Back to threads
      </button>
      <h2 className="text-xl font-semibold mb-4 font-mono">{threadId}</h2>

      {status === "loading" && <p style={{ color: "var(--color-text-muted)" }}>Loading...</p>}
      {status === "error" && <p style={{ color: "var(--color-error)" }}>Error: {error}</p>}
      {status === "ok" && (
        <div className="space-y-3">
          {data.records.map((r, i) => (
            <div
              key={i}
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
                <pre className="whitespace-pre-wrap text-xs mt-1" style={{ color: "var(--color-text)" }}>
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
