"use client";

import type { Task } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";

const statusTone: Record<Task["status"], "neutral" | "good" | "warn" | "bad" | "edge"> = {
  announced: "warn",
  assigned: "edge",
  en_route_pickup: "edge",
  en_route_dropoff: "good",
  completed: "neutral",
  orphaned: "bad",
};

export function TaskPanel({ tasks }: { tasks: Task[] }) {
  const open = tasks.filter((t) => t.status !== "completed").slice(-12).reverse();
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-line font-mono text-[11px] uppercase tracking-wide text-[#8b8677]">
        Task Queue · {open.length} open
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-line">
        {open.length === 0 && (
          <div className="px-3 py-4 text-xs text-[#8b8677] font-mono">No open tasks — press Start or Inject Task.</div>
        )}
        {open.map((t) => (
          <div key={t.id} className="px-3 py-2 flex items-center justify-between gap-2">
            <div className="font-mono text-xs">
              {t.id}
              <div className="text-[10px] text-[#8b8677]">
                @{t.pickup} → @{t.dropoff}
                {t.assignedTo ? ` · ${t.assignedTo}` : ""}
              </div>
            </div>
            <Badge tone={statusTone[t.status]}>{t.status.replace(/_/g, " ")}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
