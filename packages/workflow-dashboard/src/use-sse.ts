import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";

import type { ThreadRecord } from "./api.ts";
import { getApiKey } from "./api.ts";

export type UseSSEReturn = {
  records: ThreadRecord[];
  connected: boolean;
  completed: boolean;
};

function isWorkflowResult(record: ThreadRecord): boolean {
  return record.type === "workflow-result";
}

function parseRecord(data: string): ThreadRecord | null {
  try {
    return JSON.parse(data) as ThreadRecord;
  } catch {
    return null;
  }
}

type RecordEventContext = {
  cancelled: boolean;
  completedRef: MutableRefObject<boolean>;
  setRecords: Dispatch<SetStateAction<ThreadRecord[]>>;
  setCompleted: (value: boolean) => void;
  setConnected: (value: boolean) => void;
  cleanupEs: () => void;
};

function handleRecordEvent(ev: Event, ctx: RecordEventContext): void {
  if (ctx.cancelled) {
    return;
  }
  const msg = ev as MessageEvent;
  const raw = typeof msg.data === "string" ? msg.data : "";
  const parsed = parseRecord(raw);
  if (parsed === null) {
    return;
  }
  ctx.setRecords((prev) => [...prev, parsed]);
  if (!isWorkflowResult(parsed)) {
    return;
  }
  ctx.completedRef.current = true;
  ctx.setCompleted(true);
  ctx.setConnected(false);
  ctx.cleanupEs();
}

function sseUrl(agent: string, threadId: string): string {
  const gatewayUrl = import.meta.env.VITE_GATEWAY_URL || "";
  const key = getApiKey();
  const keyParam = key ? `?key=${encodeURIComponent(key)}` : "";
  if (gatewayUrl) {
    return `${gatewayUrl}/api/${agent}/threads/${encodeURIComponent(threadId)}/live${keyParam}`;
  }
  return `/api/threads/${encodeURIComponent(threadId)}/live`;
}

export function useSSE(agent: string | null, threadId: string | null): UseSSEReturn {
  const [records, setRecords] = useState<ThreadRecord[]>([]);
  const [connected, setConnected] = useState(false);
  const [completed, setCompleted] = useState(false);

  const completedRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);

  useEffect(() => {
    if (threadId === null || agent === null) {
      completedRef.current = false;
      reconnectAttemptsRef.current = 0;
      setRecords([]);
      setConnected(false);
      setCompleted(false);
      return;
    }

    const tid = threadId;
    const agentName = agent;

    completedRef.current = false;
    reconnectAttemptsRef.current = 0;
    setRecords([]);
    setConnected(false);
    setCompleted(false);

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function cleanupEs(): void {
      if (es !== null) {
        es.close();
        es = null;
      }
    }

    function scheduleReconnect(): void {
      if (cancelled || completedRef.current) {
        return;
      }
      const delayMs = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 8000);
      reconnectAttemptsRef.current += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!cancelled && !completedRef.current) {
          connect();
        }
      }, delayMs);
    }

    function connect(): void {
      if (cancelled || completedRef.current) {
        return;
      }

      cleanupEs();
      const url = sseUrl(agentName, tid);
      es = new EventSource(url);

      es.onopen = () => {
        if (cancelled) {
          return;
        }
        reconnectAttemptsRef.current = 0;
        setConnected(true);
        setRecords([]);
      };

      es.addEventListener("record", (ev: Event) =>
        handleRecordEvent(ev, {
          cancelled,
          completedRef,
          setRecords,
          setCompleted,
          setConnected,
          cleanupEs,
        }),
      );

      es.onerror = () => {
        if (cancelled || completedRef.current) {
          return;
        }
        setConnected(false);
        cleanupEs();
        scheduleReconnect();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
      }
      cleanupEs();
    };
  }, [agent, threadId]);

  return { records, connected, completed };
}
