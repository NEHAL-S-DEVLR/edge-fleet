"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { StatePayload } from "@/lib/types";

interface UseSimResult {
  state: StatePayload | null;
  connected: boolean;
  start: () => void;
  pause: () => void;
  reset: () => void;
  killTaskServer: () => void;
  reviveTaskServer: () => void;
  killRobot: (id: string) => void;
  reviveRobot: (id: string) => void;
  addTask: () => void;
}

async function post(path: string) {
  try {
    await fetch(path, { method: "POST" });
  } catch {
    // best-effort — the next state push will reflect reality either way
  }
}

export function useSimulationSocket(): UseSimResult {
  const [state, setState] = useState<StatePayload | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryDelay = 800;

    function connect() {
      if (cancelled) return;
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retryDelay = 800;
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "state") setState(msg.data as StatePayload);
        } catch {
          // ignore malformed frame
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) {
          // fall back to polling /api/state so the dashboard doesn't go
          // fully dark if the socket drops, then keep retrying the socket
          if (!pollRef.current) {
            pollRef.current = setInterval(async () => {
              try {
                const res = await fetch("/api/state");
                if (res.ok) setState(await res.json());
              } catch {
                /* ignore */
              }
            }, 1000);
          }
          setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 1.5, 8000);
        }
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      cancelled = true;
      wsRef.current?.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const start = useCallback(() => post("/api/simulation/start"), []);
  const pause = useCallback(() => post("/api/simulation/pause"), []);
  const reset = useCallback(() => post("/api/simulation/reset"), []);
  const killTaskServer = useCallback(() => post("/api/simulation/kill-task-server"), []);
  const reviveTaskServer = useCallback(() => post("/api/simulation/revive-task-server"), []);
  const killRobot = useCallback((id: string) => post(`/api/simulation/kill-robot/${id}`), []);
  const reviveRobot = useCallback((id: string) => post(`/api/simulation/revive-robot/${id}`), []);
  const addTask = useCallback(() => {
    fetch("/api/tasks", { method: "POST" }).catch(() => {});
  }, []);

  return { state, connected, start, pause, reset, killTaskServer, reviveTaskServer, killRobot, reviveRobot, addTask };
}
