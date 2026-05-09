import { useCallback, useEffect, useState } from "react";

type View = "threads" | "workflows";

type HashRoute = {
  view: View;
  agent: string | null;
  threadId: string | null;
};

function parseHash(hash: string): HashRoute {
  const raw = hash.replace(/^#\/?/, "");
  // Format: #agent/threads/id or #agent/workflows or #threads or #workflows
  const parts = raw.split("/");

  // Check if first part is a known view
  if (parts[0] === "threads" || parts[0] === "workflows") {
    return {
      view: parts[0] as View,
      agent: null,
      threadId: parts[0] === "threads" && parts.length > 1 ? parts.slice(1).join("/") : null,
    };
  }

  // First part is agent name
  const agent = parts[0] || null;
  const viewPart = parts[1] ?? "threads";
  const view: View = viewPart === "workflows" ? "workflows" : "threads";
  const threadId = view === "threads" && parts.length > 2 ? parts.slice(2).join("/") : null;

  return { view, agent, threadId };
}

function buildHash(route: HashRoute): string {
  const prefix = route.agent ? `${route.agent}/` : "";
  if (route.view === "workflows") {
    return `#${prefix}workflows`;
  }
  if (route.threadId !== null) {
    return `#${prefix}threads/${route.threadId}`;
  }
  return `#${prefix}threads`;
}

export function useHashRoute(): {
  view: View;
  agent: string | null;
  threadId: string | null;
  setView: (v: View) => void;
  setAgent: (a: string | null) => void;
  setThreadId: (id: string | null) => void;
} {
  const [route, setRoute] = useState<HashRoute>(() => parseHash(window.location.hash));

  useEffect(() => {
    function onHashChange(): void {
      setRoute(parseHash(window.location.hash));
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = useCallback((next: HashRoute) => {
    const hash = buildHash(next);
    window.location.hash = hash;
    setRoute(next);
  }, []);

  const setView = useCallback(
    (v: View) => navigate({ view: v, agent: route.agent, threadId: null }),
    [navigate, route.agent],
  );

  const setAgent = useCallback(
    (a: string | null) => navigate({ view: route.view, agent: a, threadId: null }),
    [navigate, route.view],
  );

  const setThreadId = useCallback(
    (id: string | null) => navigate({ view: "threads", agent: route.agent, threadId: id }),
    [navigate, route.agent],
  );

  return { view: route.view, agent: route.agent, threadId: route.threadId, setView, setAgent, setThreadId };
}
