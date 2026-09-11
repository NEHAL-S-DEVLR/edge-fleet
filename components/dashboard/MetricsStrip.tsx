"use client";

import type { MetricsSnapshot } from "@/lib/types";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-2 border-r border-line last:border-r-0">
      <span className="font-mono text-[10px] uppercase tracking-wide text-[#8b8677]">{label}</span>
      <span className="font-display text-xl leading-none tabular-nums">{value}</span>
    </div>
  );
}

export function MetricsStrip({ metrics }: { metrics: MetricsSnapshot }) {
  return (
    <div className="flex flex-wrap items-stretch bg-surface border-t border-line overflow-x-auto">
      <Stat label="Active Robots" value={`${metrics.activeRobotCount}/${metrics.totalRobotCount}`} />
      <Stat label="Tasks Completed" value={metrics.tasksCompleted} />
      <Stat label="Tasks In Progress" value={metrics.tasksInProgress} />
      <Stat label="Collisions Avoided" value={metrics.collisionsAvoided} />
      <Stat label="Msgs / sec" value={metrics.messagesLastSecond} />
      <Stat label="Avg Bid Latency" value={`${metrics.avgBidLatencyTicks}t`} />
      <Stat label="Avg Inference" value={`${metrics.avgInferenceLatencyMs}ms`} />
    </div>
  );
}
