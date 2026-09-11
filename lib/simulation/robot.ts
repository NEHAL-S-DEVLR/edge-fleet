// Per-robot decision logic. Every function here only ever reads the ONE
// robot object it's given (plus the static warehouse graph) — it never
// reaches into `state.robots` to peek at anyone else. Anything a robot
// needs to know about its neighbors arrives through the MessageBus.
import type { Robot, SimulationState, Task, NodeId } from "@/lib/types";
import { findPath, pathLength } from "@/lib/simulation/pathfinding";
import type { MessageBus } from "@/lib/simulation/messageBus";

/** Cost a robot bids for a task: travel distance to pickup, penalized for low battery. */
export function computeBidCost(state: SimulationState, robot: Robot, task: Task): number {
  const dist = pathLength(state.warehouse, robot.node, task.pickup);
  if (!Number.isFinite(dist)) return Infinity;
  const batteryPenalty = (100 - robot.battery) * 0.15;
  return dist + batteryPenalty;
}

export function planPathTo(state: SimulationState, robot: Robot, dest: NodeId) {
  const full = findPath(state.warehouse, robot.node, dest);
  // full[0] is the robot's current node — drop it, path holds only remaining hops
  robot.path = full.slice(1);
}

/**
 * Robot decides where it wants to be next tick and publishes that intent.
 * Does NOT move yet — the engine collects every robot's intent first,
 * resolves conflicts, then calls applyMove() only for the winners.
 */
export function publishIntent(robot: Robot, bus: MessageBus) {
  if (!robot.alive) return;
  if ((robot.status !== "moving" && robot.status !== "charging") || robot.path.length === 0) return;
  bus.publish("intent", { robotId: robot.id, fromNode: robot.node, toNode: robot.path[0] });
}

export function applyMove(robot: Robot) {
  if (robot.path.length === 0) return;
  robot.node = robot.path.shift()!;
  robot.battery = Math.max(0, robot.battery - 0.4);
  robot.waitTicks = 0;
}

export function registerYield(robot: Robot) {
  robot.waitTicks += 1;
}
