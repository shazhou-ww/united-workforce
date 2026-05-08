import { getHealth } from "../api.ts";
import { useFetch } from "../hooks.ts";

type Props = {
  onRun: () => void;
};

export function StatusBar({ onRun }: Props) {
  const health = useFetch(() => getHealth(), []);

  return (
    <div
      className="flex items-center justify-between px-6 py-2 text-xs border-b"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="flex items-center gap-4">
        <span style={{ color: "var(--color-text-muted)" }}>Local API: 127.0.0.1:7860</span>
        <button
          onClick={onRun}
          className="px-3 py-1 rounded text-xs font-medium"
          style={{ background: "var(--color-accent)", color: "#fff" }}
        >
          ▶ Run Thread
        </button>
      </div>
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
