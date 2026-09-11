// Per-robot decision logic. Every function here only ever reads the ONE
// robot object it's given (plus the static warehouse graph) — it never
// reaches into `state.robots` to peek at anyone else. Anything a robot
// needs to know about its neighbors arrives through the MessageBus.
//
// bidCost() and planPath() below take a bare (warehouse, node, ...) signature
// rather than the full SimulationState/Robot/Task objects on purpose: it's
// what lets a robot's decision genuinely run in a separate OS process (see
// agents/robotAgent.ts) and call the EXACT SAME function real distributed
// agents would — no reimplementation, no risk of the two transports
// (in-process MessageBus vs. real UDP, lib/transport/) drifting apart on
// what "the algorithm" actually is. computeBidCost()/planPathTo() are the
// in-process convenience wrappers the tick engine itself uses.
import type { Robot, SimulationState, Task, NodeId, Warehouse } from "@/lib/types";
import { findPath, pathLength } from "@/lib/simulation/pathfinding";
import type { MessageBus } from "@/lib/simulation/messageBus";

/** Cost to bid on a task pickup: travel distance, penalized for low battery.
 * Pure function of the warehouse graph + one robot's own public state — the
 * same inputs a robot on its own hardware would actually have. */
export function bidCost(warehouse: Warehouse, robotNode: NodeId, robotBattery: number, taskPickup: NodeId): number {
  const dist = pathLength(warehouse, robotNode, taskPickup);
  if (!Number.isFinite(dist)) return Infinity;
  const batteryPenalty = (100 - robotBattery) * 0.15;
  return dist + batteryPenalty;
}

/** A* path from a node to a destination, INCLUDING neither... — actually
 * excludes the starting node (see findPath's own doc: it includes start);
 * this trims it so the result is "remaining hops," matching Robot.path's
 * contract (path[0] is the next hop, not the current node). */
export function planPath(warehouse: Warehouse, fromNode: NodeId, dest: NodeId): NodeId[] {
  const full = findPath(warehouse, fromNode, dest);
  return full.slice(1);
}

/** Cost a robot bids for a task: travel distance to pickup, penalized for low battery. */
export function computeBidCost(state: SimulationState, robot: Robot, task: Task): number {
  return bidCost(state.warehouse, robot.node, robot.battery, task.pickup);
}

export function planPathTo(state: SimulationState, robot: Robot, dest: NodeId) {
  robot.path = planPath(state.warehouse, robot.node, dest);
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
