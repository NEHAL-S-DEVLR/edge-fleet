"use client";

import type { Robot } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

const statusTone: Record<Robot["status"], "neutral" | "good" | "warn" | "bad" | "edge"> = {
  idle: "neutral",
  bidding: "edge",
  moving: "good",
  charging: "warn",
  dead: "bad",
};

export function FleetPanel({
  robots,
  onKill,
  onRevive,
}: {
  robots: Robot[];
  onKill: (id: string) => void;
  onRevive: (id: string) => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-line font-mono text-[11px] uppercase tracking-wide text-[#8b8677]">
        Fleet · {robots.filter((r) => r.alive).length}/{robots.length} online
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-line">
        {robots.map((r) => (
          <div key={r.id} className="px-3 py-2.5 flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.alive ? r.color : "#4a4d51" }} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs">{r.name}</span>
                <Badge tone={statusTone[r.status]}>{r.status}</Badge>
              </div>
              <div className="mt-1 h-1 w-full bg-surface2 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${r.battery}%`,
                    background: r.battery < 20 ? "#e0584f" : r.battery < 50 ? "#d9a53c" : "#5aab6b",
                  }}
                />
              </div>
              <div className="mt-1 font-mono text-[10px] text-[#8b8677]">
                batt {Math.round(r.battery)}% · node {r.node}
                {r.taskId ? ` · ${r.taskId}` : ""}
                {r.waitTicks > 0 ? ` · waiting ${r.waitTicks}t` : ""}
              </div>
            </div>
            {r.alive ? (
              <Button variant="danger" onClick={() => onKill(r.id)}>
                Kill
              </Button>
            ) : (
              <Button variant="primary" onClick={() => onRevive(r.id)}>
                Revive
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
