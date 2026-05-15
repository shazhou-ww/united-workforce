import { listWorkflows } from "../api.ts";
import { useFetch } from "../hooks.ts";

type Props = {
  client: string;
  onSelect: (name: string) => void;
};

export function WorkflowList({ client, onSelect }: Props) {
  const { status, data, error } = useFetch(() => listWorkflows(client), [client]);

  if (status === "loading")
    return <p style={{ color: "var(--color-text-muted)" }}>Loading workflows...</p>;
  if (status === "error") return <p style={{ color: "var(--color-error)" }}>Error: {error}</p>;

  const workflows = data.workflows;

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Workflows</h2>
      {workflows.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>No workflows registered.</p>
      ) : (
        <div className="space-y-2">
          {workflows.map((w) => (
            <button
              key={w.name}
              type="button"
              onClick={() => onSelect(w.name)}
              className="w-full text-left p-4 rounded-lg border hover:opacity-90"
              style={{
                background: "var(--color-surface)",
                borderColor: "var(--color-border)",
                color: "var(--color-text)",
              }}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{w.name}</span>
              </div>
              <code
                className="text-xs mt-1 block font-mono truncate"
                style={{ color: "var(--color-accent)" }}
              >
                {w.hash !== null ? w.hash : "—"}
              </code>
              {w.timestamp !== null ? (
                <span className="text-xs mt-1 block" style={{ color: "var(--color-text-muted)" }}>
                  Updated {new Date(w.timestamp).toLocaleString()}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
