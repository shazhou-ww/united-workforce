import { useEffect } from "react";
import type { AgentEndpoint } from "../api.ts";
import { listAgents } from "../api.ts";
import { useFetch } from "../hooks.ts";

type Props = {
  view: "threads" | "workflows";
  agent: string | null;
  onViewChange: (v: "threads" | "workflows") => void;
  onAgentChange: (a: string | null) => void;
  onLogout: () => void;
};

export function Sidebar({ view, agent, onViewChange, onAgentChange, onLogout }: Props) {
  const { status, data } = useFetch(() => listAgents(), []);

  const agents: AgentEndpoint[] = status === "ok" ? data : [];

  // Auto-select first agent when none is selected
  useEffect(() => {
    if (agent === null && agents.length > 0) {
      onAgentChange(agents[0].name);
    }
  }, [agent, agents, onAgentChange]);

  const viewItems = [
    { key: "threads" as const, label: "Threads", icon: "⚡" },
    { key: "workflows" as const, label: "Workflows", icon: "📦" },
  ];

  return (
    <aside
      className="w-56 border-r flex flex-col"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="p-4 border-b" style={{ borderColor: "var(--color-border)" }}>
        <h1 className="text-lg font-semibold" style={{ color: "var(--color-accent)" }}>
          ⚙ Workflow
        </h1>
        <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
          Dashboard
        </p>
      </div>

      {/* Agent selector */}
      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
        <label
          className="block text-xs font-medium mb-1"
          style={{ color: "var(--color-text-muted)" }}
          htmlFor="agent-select"
        >
          Agent
        </label>
        <select
          id="agent-select"
          className="w-full rounded px-2 py-1.5 text-xs"
          style={{
            background: "var(--color-bg)",
            color: "var(--color-text)",
            border: "1px solid var(--color-border)",
          }}
          value={agent ?? ""}
          onChange={(e) => onAgentChange(e.target.value || null)}
          disabled={status === "loading"}
        >
          {status === "loading" ? (
            <option value="">Loading…</option>
          ) : agents.length === 0 ? (
            <option value="">No agents online</option>
          ) : (
            agents.map((a) => (
              <option key={a.name} value={a.name}>
                {a.status === "online" ? "🟢" : "🔴"} {a.name}
              </option>
            ))
          )}
        </select>
      </div>

      {/* View navigation */}
      <nav className="flex-1 p-2 space-y-1">
        {viewItems.map((item) => (
          <button
            type="button"
            key={item.key}
            onClick={() => onViewChange(item.key)}
            className="w-full text-left px-3 py-2 rounded text-sm transition-colors"
            style={{
              background: view === item.key ? "var(--color-accent-dim)" : "transparent",
              color: view === item.key ? "#fff" : "var(--color-text-muted)",
            }}
          >
            {item.icon} {item.label}
          </button>
        ))}
      </nav>

      <div className="p-2 border-t" style={{ borderColor: "var(--color-border)" }}>
        <button
          type="button"
          onClick={onLogout}
          className="w-full text-left px-3 py-2 rounded text-xs transition-colors"
          style={{ color: "var(--color-text-muted)" }}
        >
          🚪 Logout
        </button>
      </div>
    </aside>
  );
}
