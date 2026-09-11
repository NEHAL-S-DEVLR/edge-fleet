// The task server. On purpose, this is the ONLY thing in the system that
// looks even a little bit "central" — and even then, all it does is
// announce work. It never tells a robot where to go, never resolves a
// collision, and never picks who wins a task (see auction.ts for that).
// Kill it (FR7) and the fleet keeps moving and keeps avoiding each other;
// the only thing that stops is *new* work being handed out.
import type { SimulationState, NodeId, Task } from "@/lib/types";
import { logMessage } from "@/lib/state/store";

let taskCounter = 0;

function randomWalkableNode(state: SimulationState): NodeId {
  const nodes = state.warehouse.nodes;
  return nodes[Math.floor(Math.random() * nodes.length)].id;
}

export function createTask(state: SimulationState, pickup?: NodeId, dropoff?: NodeId, urgent?: boolean): Task {
  let p = pickup ?? randomWalkableNode(state);
  let d = dropoff ?? randomWalkableNode(state);
  let guard = 0;
  while (d === p && guard < 10) {
    d = randomWalkableNode(state);
    guard++;
  }
  taskCounter += 1;
  // Urgent tasks (STAT medication, a stalled production cell, a time-critical
  // container move) are randomly assigned by state.urgencyRatio when not
  // specified explicitly — see auction.ts for how urgency affects bidding order.
  const isUrgent = urgent !== undefined ? urgent : Math.random() < (state.urgencyRatio ?? 0);
  const task: Task = {
    id: `t${taskCounter}`,
    pickup: p,
    dropoff: d,
    status: "announced",
    assignedTo: null,
    urgent: isUrgent,
    createdTick: state.tick,
    assignedTick: null,
    completedTick: null,
    bids: [],
  };
  state.tasks.push(task);
  logMessage(
    state,
    "task-announced",
    "task-server",
    `${isUrgent ? "⚠ URGENT — " : ""}Task ${task.id} announced: pickup @${p} -> dropoff @${d}`,
    { taskId: task.id, pickup: p, dropoff: d, urgent: isUrgent }
  );
  return task;
}

const MIN_GAP_TICKS = 14;
const MAX_GAP_TICKS = 30;
const MAX_OPEN_TASKS = 6;

export function maybeAnnounceTask(state: SimulationState) {
  if (!state.taskServerAlive) return;
  if (state.tick < state.nextTaskAt) return;

  const maxOpen = state.maxOpenTasks ?? MAX_OPEN_TASKS;
  const minGap = state.taskMinGap ?? MIN_GAP_TICKS;
  const maxGap = state.taskMaxGap ?? MAX_GAP_TICKS;

  const openTasks = state.tasks.filter((t) => t.status === "announced" || t.status === "assigned" || t.status === "en_route_pickup" || t.status === "en_route_dropoff").length;
  if (openTasks < maxOpen) {
    createTask(state);
  }
  const gap = minGap + Math.floor(Math.random() * Math.max(1, maxGap - minGap));
  state.nextTaskAt = state.tick + gap;
}
