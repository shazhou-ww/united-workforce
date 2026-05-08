type Props = {
  view: "threads" | "workflows";
  onViewChange: (v: "threads" | "workflows") => void;
};

export function Sidebar({ view, onViewChange }: Props) {
  const items = [
    { key: "threads" as const, label: "Threads", icon: "⚡" },
    { key: "workflows" as const, label: "Workflows", icon: "📦" },
  ];

  return (
    <aside className="w-56 border-r flex flex-col" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
      <div className="p-4 border-b" style={{ borderColor: "var(--color-border)" }}>
        <h1 className="text-lg font-semibold" style={{ color: "var(--color-accent)" }}>
          ⚙ Workflow
        </h1>
        <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>Dashboard</p>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {items.map((item) => (
          <button
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
    </aside>
  );
}
