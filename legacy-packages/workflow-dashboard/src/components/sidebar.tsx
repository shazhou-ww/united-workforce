import { Loader2, LogOut, Moon, Package, Sun, Zap } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router";
import type { ClientEndpoint } from "../api.ts";
import { listClients } from "../api.ts";
import { useFetch } from "../hooks.ts";
import { cn } from "../lib/utils.ts";
import { Button } from "./ui/button.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";
import { Separator } from "./ui/separator.tsx";

type Props = {
  onLogout: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
};

export function Sidebar({ onLogout, theme, onToggleTheme }: Props) {
  const { client } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { status, data } = useFetch(() => listClients(), []);

  const clients: ClientEndpoint[] = status === "ok" ? data : [];

  const view = location.pathname.includes("/workflows") ? "workflows" : "threads";

  const viewItems = [
    { key: "threads" as const, label: "Threads", icon: Zap },
    { key: "workflows" as const, label: "Workflows", icon: Package },
  ];

  return (
    <aside className="w-56 border-r border-border flex flex-col bg-sidebar">
      <div className="p-4 border-b border-primary/20">
        <h1 className="text-xl font-bold text-foreground tracking-tight">Workflow</h1>
        <p className="text-xs text-muted-foreground mt-0.5 tracking-wide uppercase">Dashboard</p>
      </div>

      <div className="px-3 py-3">
        <label
          className="block text-xs font-medium mb-1.5 text-muted-foreground"
          htmlFor="client-select"
        >
          Client
        </label>
        {status === "loading" ? (
          <div className="h-9 rounded-md border border-input bg-transparent px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading…
          </div>
        ) : clients.length === 0 ? (
          <div className="h-9 rounded-md border border-input bg-transparent px-3 py-2 text-xs text-muted-foreground flex items-center">
            No clients online
          </div>
        ) : (
          <Select
            value={client ?? ""}
            onValueChange={(name) => {
              if (name) navigate(`/${name}/${view}`);
            }}
          >
            <SelectTrigger className="h-8 text-xs transition-colors duration-200">
              <SelectValue placeholder="Select client…" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((a) => (
                <SelectItem key={a.name} value={a.name} className="text-xs">
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-block h-2 w-2 rounded-full",
                        a.status === "online" ? "bg-success animate-pulse" : "bg-destructive",
                      )}
                    />
                    {a.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Separator />

      <nav className="flex-1 p-2 space-y-1">
        {viewItems.map((item) => (
          <Button
            key={item.key}
            variant={view === item.key ? "secondary" : "ghost"}
            size="sm"
            className={cn(
              "w-full justify-start gap-2 transition-colors duration-200",
              view === item.key
                ? "text-foreground border-l-2 border-primary rounded-l-none"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => {
              if (client) navigate(`/${client}/${item.key}`);
            }}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Button>
        ))}
      </nav>

      <Separator />

      <div className="p-2 space-y-1">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground transition-colors duration-200"
          onClick={onToggleTheme}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground transition-colors duration-200"
          onClick={onLogout}
        >
          <LogOut className="h-4 w-4" />
          Logout
        </Button>
      </div>
    </aside>
  );
}
