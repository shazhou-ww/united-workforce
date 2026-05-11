import type { RoleRecord, ThreadRecord, ThreadStartRecord, WorkflowResultRecord } from "../api.ts";
import { Markdown } from "./markdown.tsx";

const ROLE_COLORS: Record<string, string> = {
  preparer: "#8b5cf6",
  agent: "#3b82f6",
  extractor: "#f59e0b",
};

function roleColor(role: string): string {
  return ROLE_COLORS[role] ?? "var(--color-accent)";
}

function formatTime(ts: number | null): string | null {
  if (ts === null) return null;
  return new Date(ts).toLocaleTimeString();
}

function StartCard({ record }: { record: ThreadStartRecord }) {
  return (
    <div
      className="p-4 rounded-lg border"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">🚀</span>
        <span className="font-semibold" style={{ color: "var(--color-accent)" }}>
          {record.workflow}
        </span>
        <span
          className="text-xs px-2 py-0.5 rounded"
          style={{
            background: record.status === "active" ? "var(--color-success)" : "var(--color-border)",
            color: record.status === "active" ? "var(--color-bg)" : "var(--color-text-muted)",
          }}
        >
          {record.status}
        </span>
      </div>
      {record.prompt !== null && (
        <div
          className="mt-2 p-3 rounded text-sm border-l-2"
          style={{
            background: "var(--color-bg)",
            borderColor: "var(--color-accent)",
            color: "var(--color-text)",
          }}
        >
          <div className="text-xs mb-1" style={{ color: "var(--color-text-muted)" }}>
            Prompt
          </div>
          <Markdown content={record.prompt} />
        </div>
      )}
    </div>
  );
}

function RoleMessage({ record }: { record: RoleRecord }) {
  const color = roleColor(record.role);
  return (
    <div
      className="p-3 rounded-lg border text-sm"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-xs px-2 py-0.5 rounded font-mono font-medium"
          style={{ background: color, color: "#fff" }}
        >
          {record.role}
        </span>
        {formatTime(record.timestamp) !== null && (
          <span className="text-xs ml-auto" style={{ color: "var(--color-text-muted)" }}>
            {formatTime(record.timestamp)}
          </span>
        )}
      </div>
      <Markdown content={record.content} />
    </div>
  );
}

function ResultCard({ record }: { record: WorkflowResultRecord }) {
  const success = record.returnCode === 0;
  return (
    <div
      className="p-4 rounded-lg border"
      style={{
        background: "var(--color-surface)",
        borderColor: success ? "var(--color-success)" : "var(--color-error)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{success ? "✅" : "❌"}</span>
        <span className="font-semibold text-sm">{success ? "Completed" : "Failed"}</span>
        <span
          className="text-xs px-2 py-0.5 rounded font-mono"
          style={{
            background: success ? "var(--color-success)" : "var(--color-error)",
            color: "#fff",
          }}
        >
          exit {record.returnCode}
        </span>
        {formatTime(record.timestamp) !== null && (
          <span className="text-xs ml-auto" style={{ color: "var(--color-text-muted)" }}>
            {formatTime(record.timestamp)}
          </span>
        )}
      </div>
      <Markdown content={record.content} />
    </div>
  );
}

export function RecordCard({ record }: { record: ThreadRecord }) {
  switch (record.type) {
    case "thread-start":
      return <StartCard record={record} />;
    case "role":
      return <RoleMessage record={record} />;
    case "workflow-result":
      return <ResultCard record={record} />;
  }
}
