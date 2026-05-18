import { AlertCircle, Loader2, Moon, Settings, Sun } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { setApiKey } from "../api.ts";
import { useTheme } from "../hooks/use-theme.tsx";
import { Button } from "./ui/button.tsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.tsx";
import { Input } from "./ui/input.tsx";

export function LoginPage() {
  const navigate = useNavigate();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { theme, toggleTheme } = useTheme();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;

    setLoading(true);
    setError(null);

    const gatewayUrl = import.meta.env.VITE_GATEWAY_URL || "";
    try {
      const res = await fetch(`${gatewayUrl}/api/gateway/endpoints`, {
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
    navigate("/", { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-4 right-4 transition-colors duration-200"
        onClick={toggleTheme}
      >
        {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </Button>
      <Card className="w-full max-w-sm shadow-lg transition-all duration-200 hover:shadow-xl hover:border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl tracking-tight">
            <Settings className="h-5 w-5" />
            Workflow Dashboard
          </CardTitle>
          <CardDescription>Enter your API key to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="API Key"
              className="transition-all duration-200"
            />
            {error && (
              <p className="text-xs text-destructive flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={loading || !key.trim()}
              className="w-full transition-all duration-200"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying…
                </span>
              ) : (
                "Login"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
