import { useEffect } from "react";
import type { ClientEndpoint } from "../api.ts";
import { listClients } from "../api.ts";
import { useFetch } from "../hooks.ts";

type Props = {
  view: "threads" | "workflows";
  client: string | null;
  onViewChange: (v: "threads" | "workflows") => void;
  onClientChange: (a: string | null) => void;
  onLogout: () => void;
};

export function Sidebar({ view, client, onViewChange, onClientChange, onLogout }: Props) {
  const { status, data } = useFetch(() => listClients(), []);

  const clients: ClientEndpoint[] = status === "ok" ? data : [];

  // Auto-select first client when none is selected
  useEffect(() => {
    if (client === null && clients.length > 0) {
      onClientChange(clients[0].name);
    }
  }, [client, clients, onClientChange]);

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

      {/* Client selector */}
      <div className="px-4 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
        <label
          className="block text-xs font-medium mb-1"
          style={{ color: "var(--color-text-muted)" }}
          htmlFor="client-select"
        >
          Client
        </label>
        <select
          id="client-select"
          className="w-full rounded px-2 py-1.5 text-xs"
          style={{
            background: "var(--color-bg)",
            color: "var(--color-text)",
            border: "1px solid var(--color-border)",
          }}
          value={client ?? ""}
          onChange={(e) => onClientChange(e.target.value || null)}
          disabled={status === "loading"}
        >
          {status === "loading" ? (
            <option value="">Loading…</option>
          ) : clients.length === 0 ? (
            <option value="">No clients online</option>
          ) : (
            clients.map((a) => (
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
