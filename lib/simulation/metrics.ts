import type { SimulationState } from "@/lib/types";

// Matches the default TICK_MS in .env.example (150ms -> ~6.7 ticks/sec).
// Only used to window "messages in the last second" for the dashboard —
// not precision-critical.
const TICKS_PER_SECOND = 7;

export function recomputeMetrics(state: SimulationState) {
  const tasksCompleted = state.tasks.filter((t) => t.status === "completed").length;
  const tasksInProgress = state.tasks.filter((t) =>
    ["en_route_pickup", "en_route_dropoff"].includes(t.status)
  ).length;
  const activeRobotCount = state.robots.filter((r) => r.alive).length;

  const assignedTasks = state.tasks.filter((t) => t.assignedTick !== null);
  const avgBidLatencyTicks =
    assignedTasks.length > 0
      ? assignedTasks.reduce((sum, t) => sum + (t.assignedTick! - t.createdTick), 0) / assignedTasks.length
      : 0;

  const recentInference = state.edgeInference.slice(-20);
  const avgInferenceLatencyMs =
    recentInference.length > 0
      ? recentInference.reduce((sum, e) => sum + e.latencyMs, 0) / recentInference.length
      : 0;

  const windowStart = state.tick - TICKS_PER_SECOND;
  const messagesLastSecond = state.messages.filter((m) => m.tick > windowStart).length;

  const urgentOpen = state.tasks.filter((t) => t.urgent && t.status !== "completed").length;

  state.metrics = {
    tick: state.tick,
    collisionsAvoided: state.metrics.collisionsAvoided,
    tasksCompleted,
    tasksInProgress,
    messagesLastSecond,
    avgBidLatencyTicks: Math.round(avgBidLatencyTicks * 10) / 10,
    avgInferenceLatencyMs: Math.round(avgInferenceLatencyMs * 10) / 10,
    activeRobotCount,
    totalRobotCount: state.robots.length,
    throughput: state.throughput,
    currentRate: state.throughput.length ? state.throughput[state.throughput.length - 1] : 0,
    urgentOpen,
  };
}
