import { listWorkflows } from "../api.ts";
import { useFetch } from "../hooks.ts";

type Props = {
  agent: string;
};

export function WorkflowList({ agent }: Props) {
  const { status, data, error } = useFetch(() => listWorkflows(agent), [agent]);

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
            <div
              key={w.name}
              className="p-4 rounded-lg border"
              style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{w.name}</span>
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {w.versions} version{w.versions !== 1 ? "s" : ""}
                </span>
              </div>
              <code
                className="text-xs mt-1 block font-mono"
                style={{ color: "var(--color-accent)" }}
              >
                {w.currentHash}
              </code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
