import { useCallback, useEffect, useState } from "react";

type View = "threads" | "workflows";

type HashRoute = {
  view: View;
  threadId: string | null;
};

function parseHash(hash: string): HashRoute {
  const raw = hash.replace(/^#\/?/, "");
  if (raw.startsWith("threads/")) {
    const id = raw.slice("threads/".length);
    if (id.length > 0) {
      return { view: "threads", threadId: id };
    }
  }
  if (raw === "workflows") {
    return { view: "workflows", threadId: null };
  }
  return { view: "threads", threadId: null };
}

function buildHash(route: HashRoute): string {
  if (route.view === "workflows") {
    return "#workflows";
  }
  if (route.threadId !== null) {
    return `#threads/${route.threadId}`;
  }
  return "#threads";
}

export function useHashRoute(): {
  view: View;
  threadId: string | null;
  setView: (v: View) => void;
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

  const setView = useCallback((v: View) => navigate({ view: v, threadId: null }), [navigate]);

  const setThreadId = useCallback(
    (id: string | null) => navigate({ view: "threads", threadId: id }),
    [navigate],
  );

  return { view: route.view, threadId: route.threadId, setView, setThreadId };
}
