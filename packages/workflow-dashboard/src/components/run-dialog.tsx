import { useState } from "react";
import { listWorkflows, runThread } from "../api.ts";
import { useFetch } from "../hooks.ts";

type Props = {
  agent: string;
  onClose: () => void;
  onCreated: (threadId: string) => void;
};

export function RunDialog({ agent, onClose, onCreated }: Props) {
  const workflows = useFetch(() => listWorkflows(agent), [agent]);
  const [workflow, setWorkflow] = useState("");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workflow || !prompt) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await runThread(agent, workflow, prompt);
      onCreated(result.threadId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: "rgba(0,0,0,0.6)" }}
    >
      <div
        className="w-full max-w-lg p-6 rounded-lg border"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <h3 className="text-lg font-semibold mb-4">Run Thread on {agent}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="run-workflow"
              className="text-sm block mb-1"
              style={{ color: "var(--color-text-muted)" }}
            >
              Workflow
            </label>
            <select
              id="run-workflow"
              value={workflow}
              onChange={(e) => setWorkflow(e.target.value)}
              className="w-full px-3 py-2 rounded border text-sm"
              style={{
                background: "var(--color-bg)",
                borderColor: "var(--color-border)",
                color: "var(--color-text)",
              }}
            >
              <option value="">Select a workflow...</option>
              {workflows.status === "ok" &&
                workflows.data.workflows.map((w) => (
                  <option key={w.name} value={w.name}>
                    {w.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="run-prompt"
              className="text-sm block mb-1"
              style={{ color: "var(--color-text-muted)" }}
            >
              Prompt
            </label>
            <textarea
              id="run-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded border text-sm"
              style={{
                background: "var(--color-bg)",
                borderColor: "var(--color-border)",
                color: "var(--color-text)",
              }}
              placeholder="Enter the task prompt..."
            />
          </div>
          {error && (
            <p className="text-sm" style={{ color: "var(--color-error)" }}>
              {error}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded border"
              style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !workflow || !prompt}
              className="px-4 py-2 text-sm rounded"
              style={{
                background: submitting ? "var(--color-accent-dim)" : "var(--color-accent)",
                color: "#fff",
                opacity: !workflow || !prompt ? 0.5 : 1,
              }}
            >
              {submitting ? "Starting..." : "Run"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
