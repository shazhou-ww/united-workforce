import { useState } from "react";
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
  const [expanded, setExpanded] = useState(true);

  const agents: AgentEndpoint[] = status === "ok" ? data : [];
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
      <div className="border-b" style={{ borderColor: "var(--color-border)" }}>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full text-left px-4 py-2 text-xs font-medium"
          style={{ color: "var(--color-text-muted)" }}
        >
          {expanded ? "▾" : "▸"} Agents
          {agent && (
            <span className="ml-2 text-xs" style={{ color: "var(--color-accent)" }}>
              ({agent})
            </span>
          )}
        </button>
        {expanded && (
          <div className="px-2 pb-2 space-y-0.5">
            {agents.length === 0 && (
              <p className="text-xs px-2 py-1" style={{ color: "var(--color-text-muted)" }}>
                {status === "loading" ? "Loading..." : "No agents online"}
              </p>
            )}
            {agents.map((a) => (
              <button
                type="button"
                key={a.name}
                onClick={() => onAgentChange(a.name)}
                className="w-full text-left px-3 py-1.5 rounded text-xs transition-colors flex items-center gap-2"
                style={{
                  background: agent === a.name ? "var(--color-accent-dim)" : "transparent",
                  color: agent === a.name ? "#fff" : "var(--color-text-muted)",
                }}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{
                    background: a.status === "online" ? "var(--color-success)" : "var(--color-error)",
                  }}
                />
                {a.name}
              </button>
            ))}
          </div>
        )}
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
