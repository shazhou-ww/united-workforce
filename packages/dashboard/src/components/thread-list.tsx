import { listThreads } from "../api.ts";
import { useFetch } from "../hooks.ts";

type Props = {
  onSelect: (id: string) => void;
};

export function ThreadList({ onSelect }: Props) {
  const { status, data, error } = useFetch(() => listThreads(), []);

  if (status === "loading")
    return <p style={{ color: "var(--color-text-muted)" }}>Loading threads...</p>;
  if (status === "error") return <p style={{ color: "var(--color-error)" }}>Error: {error}</p>;

  const threads = data.threads;

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Threads</h2>
      {threads.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>No threads found.</p>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <button
              type="button"
              key={t.threadId}
              onClick={() => onSelect(t.threadId)}
              className="w-full text-left p-4 rounded-lg border transition-colors hover:border-[var(--color-accent-dim)]"
              style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
            >
              <div className="flex items-center justify-between">
                <code className="text-sm font-mono" style={{ color: "var(--color-accent)" }}>
                  {t.threadId}
                </code>
                {t.status && (
                  <span
                    className="text-xs px-2 py-0.5 rounded"
                    style={{
                      background:
                        t.status === "running"
                          ? "var(--color-success)"
                          : t.status === "failed"
                            ? "var(--color-error)"
                            : "var(--color-text-muted)",
                      color: "#000",
                    }}
                  >
                    {t.status}
                  </span>
                )}
              </div>
              {t.workflow && (
                <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
                  {t.workflow}
                </p>
              )}
              {t.startedAt && (
                <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
                  {t.startedAt}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
