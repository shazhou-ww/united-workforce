import { useCallback, useEffect, useState } from "react";

type View = "threads" | "workflows";

type HashRoute = {
  view: View;
  client: string | null;
  threadId: string | null;
};

function parseHash(hash: string): HashRoute {
  const raw = hash.replace(/^#\/?/, "");
  // Format: #client/threads/id or #client/workflows or #threads or #workflows
  const parts = raw.split("/");

  // Check if first part is a known view
  if (parts[0] === "threads" || parts[0] === "workflows") {
    return {
      view: parts[0] as View,
      client: null,
      threadId: parts[0] === "threads" && parts.length > 1 ? parts.slice(1).join("/") : null,
    };
  }

  // First part is client name
  const client = parts[0] || null;
  const viewPart = parts[1] ?? "threads";
  const view: View = viewPart === "workflows" ? "workflows" : "threads";
  const threadId = view === "threads" && parts.length > 2 ? parts.slice(2).join("/") : null;

  return { view, client, threadId };
}

function buildHash(route: HashRoute): string {
  const prefix = route.client ? `${route.client}/` : "";
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
  client: string | null;
  threadId: string | null;
  setView: (v: View) => void;
  setClient: (a: string | null) => void;
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
    (v: View) => navigate({ view: v, client: route.client, threadId: null }),
    [navigate, route.client],
  );

  const setClient = useCallback(
    (a: string | null) => navigate({ view: route.view, client: a, threadId: null }),
    [navigate, route.view],
  );

  const setThreadId = useCallback(
    (id: string | null) => navigate({ view: "threads", client: route.client, threadId: id }),
    [navigate, route.client],
  );

  return {
    view: route.view,
    client: route.client,
    threadId: route.threadId,
    setView,
    setClient,
    setThreadId,
  };
}
