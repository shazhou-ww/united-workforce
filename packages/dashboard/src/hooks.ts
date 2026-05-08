import { useEffect, useState } from "react";

type FetchState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ok"; data: T; error: null }
  | { status: "error"; data: null; error: string };

export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = []): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", data: null, error: null });
    fetcher()
      .then((data) => {
        if (!cancelled) setState({ status: "ok", data, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({
            status: "error",
            data: null,
            error: err instanceof Error ? err.message : String(err),
          });
      });
    return () => {
      cancelled = true;
    };
  }, deps);

  return state;
}
