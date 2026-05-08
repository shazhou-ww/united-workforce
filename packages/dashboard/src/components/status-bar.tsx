import { getHealth } from "../api.ts";
import { useFetch } from "../hooks.ts";

export function StatusBar() {
  const health = useFetch(() => getHealth(), []);

  return (
    <div
      className="flex items-center justify-between px-6 py-2 text-xs border-b"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <span style={{ color: "var(--color-text-muted)" }}>Local API: 127.0.0.1:7860</span>
      <span>
        {health.status === "loading" && "⏳ Connecting..."}
        {health.status === "ok" && (
          <span style={{ color: "var(--color-success)" }}>● Connected</span>
        )}
        {health.status === "error" && (
          <span style={{ color: "var(--color-error)" }}>● Offline</span>
        )}
      </span>
    </div>
  );
}
