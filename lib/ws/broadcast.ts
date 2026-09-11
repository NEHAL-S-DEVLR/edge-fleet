import type { SimulationState, StatePayload } from "@/lib/types";
import { getWSClients } from "@/lib/state/store";

export function toPayload(state: SimulationState): StatePayload {
  return {
    tick: state.tick,
    running: state.running,
    taskServerAlive: state.taskServerAlive,
    warehouse: state.warehouse,
    robots: state.robots,
    tasks: state.tasks,
    messages: state.messages.slice(-60),
    edgeInference: state.edgeInference.slice(-20),
    metrics: state.metrics,
    heat: state.heat,
  };
}

/** Pushes the current state to every connected dashboard. Called once per tick by server.ts. */
export function broadcastState(state: SimulationState) {
  const clients = getWSClients();
  if (clients.size === 0) return;
  const msg = JSON.stringify({ type: "state", data: toPayload(state) });
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(msg);
    }
  }
}
