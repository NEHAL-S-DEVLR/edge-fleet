"use client";

import { useEffect, useRef } from "react";
import type { MessageLogEntry } from "@/lib/types";

const typeColor: Record<string, string> = {
  "task-announced": "#d9a53c",
  bid: "#8b8677",
  "task-assigned": "#3fbdb7",
  "task-picked": "#3fbdb7",
  "task-completed": "#5aab6b",
  "task-orphaned": "#e0584f",
  yield: "#e0584f",
  "collision-avoided": "#ff8248",
  "robot-killed": "#e0584f",
  "robot-revived": "#5aab6b",
  "task-server-killed": "#e0584f",
  "task-server-revived": "#5aab6b",
  "edge-inference": "#8a7cff",
  "sim-reset": "#8b8677",
  "sim-start": "#5aab6b",
  "sim-pause": "#8b8677",
};

export function EventLog({ messages }: { messages: MessageLogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [messages.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-line font-mono text-[11px] uppercase tracking-wide text-[#8b8677]">
        Message Log · proof of real traffic, not a scripted animation
      </div>
      <div ref={ref} className="flex-1 overflow-y-auto px-3 py-2 space-y-1 font-mono text-[11px] leading-relaxed">
        {messages.map((m) => (
          <div key={m.id}>
            <span className="text-[#5c584e]">t{m.tick}</span>{" "}
            <span style={{ color: typeColor[m.type] ?? "#aeab9f" }}>[{m.type}]</span>{" "}
            <span className="text-[#ecebe6]">{m.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
