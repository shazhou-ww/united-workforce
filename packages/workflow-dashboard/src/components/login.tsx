import { useState } from "react";
import { setApiKey } from "../api.ts";

type Props = {
  onLogin: () => void;
};

export function LoginPage({ onLogin }: Props) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;

    setLoading(true);
    setError(null);

    // Test the key by hitting the endpoints list
    const gatewayUrl = import.meta.env.VITE_GATEWAY_URL || "";
    try {
      const res = await fetch(`${gatewayUrl}/endpoints`, {
        headers: { Authorization: `Bearer ${key.trim()}` },
      });
      if (res.status === 401) {
        setError("Invalid API key");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError(`Server error: ${res.status}`);
        setLoading(false);
        return;
      }
    } catch (err) {
      setError(`Connection failed: ${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
      return;
    }

    setApiKey(key.trim());
    onLogin();
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--color-bg)" }}>
      <div
        className="p-8 rounded-lg border w-full max-w-sm"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <h1 className="text-xl font-bold mb-1" style={{ color: "var(--color-accent)" }}>
          ⚙ Workflow Dashboard
        </h1>
        <p className="text-sm mb-6" style={{ color: "var(--color-text-muted)" }}>
          Enter your API key to continue
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="API Key"
            className="w-full px-3 py-2 rounded border text-sm mb-3 outline-none"
            style={{
              background: "var(--color-bg)",
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
            }}
            autoFocus
          />
          {error && (
            <p className="text-xs mb-3" style={{ color: "var(--color-error)" }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading || !key.trim()}
            className="w-full px-3 py-2 rounded text-sm font-medium"
            style={{
              background: "var(--color-accent)",
              color: "var(--color-bg)",
              opacity: loading || !key.trim() ? 0.5 : 1,
            }}
          >
            {loading ? "Verifying..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}
