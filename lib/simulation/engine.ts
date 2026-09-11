// The tick loop. This file is the closest thing this codebase has to a
// "coordinator," and it's worth being precise about what it does and
// doesn't do: it advances physics (movement, battery), runs the public
// conflict-resolution rule, and calls into taskServer/auction — it never
// picks a task winner itself (auction.ts does, per-robot) and it never
// tells a healthy robot where to go (robot.ts does, from its own bids).
//
// This used to say "delete this file's central loop and replace it with N
// separate robot processes... that's the intended next step." That step is
// now built — see lib/transport/coordinator.ts and agents/robotAgent.ts.
// The auction winner rule (pickWinningBid) and the movement conflict rule
// (resolveMovementConflicts) are pure functions shared verbatim between
// this in-process tick loop and the real UDP transport, so both paths are
// provably running the identical algorithm, not two implementations that
// could drift. This file remains the simpler, lower-latency default the
// live dashboard uses; the UDP path is for proving FR2 literally (see
// docs/DISTRIBUTED_TRANSPORT.md) — a demo mode, not a dashboard swap-in,
// because a real network round-trip per tick isn't worth paying for when
// nothing here actually needs to lie to itself about being on one machine.
import type { SimulationState, NodeId } from "@/lib/types";
import { maybeAnnounceTask } from "@/lib/simulation/taskServer";
import { runAuctions } from "@/lib/simulation/auction";
import { planPathTo, publishIntent, applyMove, registerYield } from "@/lib/simulation/robot";
import { pathLength } from "@/lib/simulation/pathfinding";
import { resolveMovementConflicts } from "@/lib/simulation/conflicts";
import { MessageBus } from "@/lib/simulation/messageBus";
import { logMessage, getStore } from "@/lib/state/store";
import { recomputeMetrics } from "@/lib/simulation/metrics";

function checkArrivals(state: SimulationState) {
  for (const robot of state.robots) {
    if (!robot.alive || robot.status !== "moving" || robot.path.length !== 0) continue;
    const task = state.tasks.find((t) => t.id === robot.taskId);
    if (!task) {
      robot.status = "idle";
      robot.taskId = null;
      continue;
    }
    if (task.status === "en_route_pickup" && robot.node === task.pickup) {
      task.status = "en_route_dropoff";
      planPathTo(state, robot, task.dropoff);
      logMessage(state, "task-picked", robot.id, `${robot.name} picked up ${task.id}, heading to dropoff`, {
        taskId: task.id,
      });
    } else if (task.status === "en_route_dropoff" && robot.node === task.dropoff) {
      task.status = "completed";
      task.completedTick = state.tick;
      robot.status = "idle";
      robot.taskId = null;
      state._justCompleted += 1;
      logMessage(state, "task-completed", robot.id, `${robot.name} completed ${task.id}`, { taskId: task.id });
    }
  }
}

function handleBatteryAndCharging(state: SimulationState) {
  const chargeNodes = state.warehouse.nodes.filter((n) => n.kind === "charge");
  for (const robot of state.robots) {
    if (!robot.alive) continue;
    if (robot.status === "idle" && robot.battery < 20 && chargeNodes.length > 0) {
      let nearest = chargeNodes[0];
      let best = pathLength(state.warehouse, robot.node, nearest.id);
      for (const n of chargeNodes) {
        const d = pathLength(state.warehouse, robot.node, n.id);
        if (d < best) {
          best = d;
          nearest = n;
        }
      }
      planPathTo(state, robot, nearest.id);
      robot.status = "charging";
    } else if (robot.status === "charging" && robot.path.length === 0) {
      robot.battery = Math.min(100, robot.battery + 3);
      if (robot.battery >= 95) robot.status = "idle";
    }
  }
}

// Congestion heat: a lightweight per-node counter, bumped wherever robots
// actually get stuck and decayed a little every tick — the same signal an
// operations dashboard would call "chokepoint utilization." It's a pure
// metrics/visualization signal: nothing in pathfinding or the auction ever
// reads it back, so it cannot change simulation outcomes.
function bumpHeat(state: SimulationState, nodeId: NodeId, amount: number) {
  state.heat[nodeId] = (state.heat[nodeId] ?? 0) + amount;
}

function decayHeat(state: SimulationState) {
  for (const key of Object.keys(state.heat)) {
    const id = Number(key);
    state.heat[id] *= 0.95;
    if (state.heat[id] < 0.05) delete state.heat[id];
  }
}

/**
 * An idle robot parked on a node someone else needs is a livelock waiting
 * to happen: the wait-priority rule below only ranks robots that are both
 * trying to move, so a stationary robot would otherwise block that cell
 * forever. This is the fix — after a few ticks of being sat on top of,
 * an idle robot voluntarily steps to a free neighboring cell, the same
 * "excuse me" behavior a human forklift driver does at a blocked aisle.
 */
function handleCourtesyYield(state: SimulationState, intents: { robotId: string; fromNode: number; toNode: number }[]) {
  if (intents.length === 0) return;
  const contendedTargets = new Set(intents.map((i) => i.toNode));
  const occupiedNodes = new Set(state.robots.filter((r) => r.alive).map((r) => r.node));

  for (const robot of state.robots) {
    if (!robot.alive || robot.status !== "idle") continue;
    if (!contendedTargets.has(robot.node)) continue;

    robot.waitTicks += 1;
    bumpHeat(state, robot.node, 0.4);
    if (robot.waitTicks < 3) continue;

    const neighbors = state.warehouse.adjacency[robot.node] ?? [];
    const free = neighbors.find((n) => !occupiedNodes.has(n) && !contendedTargets.has(n));
    robot.waitTicks = 0;
    if (free !== undefined) {
      robot.status = "moving"; // taskId stays null — checkArrivals() sends it back to idle on arrival
      robot.path = [free];
      logMessage(state, "yield", robot.id, `${robot.name} steps aside to clear a held-up aisle`, {
        from: robot.node,
        to: free,
      });
    }
  }
}

function resolveMovement(state: SimulationState, bus: MessageBus) {
  for (const robot of state.robots) publishIntent(robot, bus);
  const intents = bus.drain("intent");
  handleCourtesyYield(state, intents);
  if (intents.length === 0) return;

  const robotsById = new Map(state.robots.map((r) => [r.id, r]));

  const movingIds = new Set(intents.map((i) => i.robotId));
  const staticOccupied = new Set<NodeId>();
  for (const r of state.robots) {
    if (!movingIds.has(r.id)) staticOccupied.add(r.node);
  }

  const blocked = resolveMovementConflicts(intents, (robotId) => robotsById.get(robotId)?.waitTicks ?? 0, staticOccupied);

  let collisionsThisTick = 0;
  for (const i of intents) {
    const robot = robotsById.get(i.robotId)!;
    if (blocked.has(i.robotId)) {
      registerYield(robot);
      bumpHeat(state, robot.node, 1);
      bus.publish("yield", { robotId: robot.id, atNode: robot.node, reason: "conflict" });
      logMessage(state, "yield", robot.id, `${robot.name} yields at node ${robot.node} to avoid a conflict`, {
        node: robot.node,
      });
      collisionsThisTick++;
    } else {
      applyMove(robot);
    }
  }
  if (collisionsThisTick > 0) {
    state.metrics.collisionsAvoided += collisionsThisTick;
    logMessage(
      state,
      "collision-avoided",
      "system",
      `${collisionsThisTick} potential collision${collisionsThisTick > 1 ? "s" : ""} resolved via local yield`,
      { count: collisionsThisTick }
    );
  }
}

function pruneOldTasks(state: SimulationState) {
  const completed = state.tasks.filter((t) => t.status === "completed");
  if (completed.length > 25) {
    const toRemoveIds = new Set(completed.slice(0, completed.length - 25).map((t) => t.id));
    state.tasks = state.tasks.filter((t) => !toRemoveIds.has(t.id));
  }
}

/** Rolls state._justCompleted (reset each tick, incremented in checkArrivals) into
 * a fixed-size rolling bucket of "tasks completed per _bucketSize ticks." */
function updateThroughput(state: SimulationState) {
  state._bucketTicks += 1;
  state._bucketCompleted += state._justCompleted;
  if (state._bucketTicks >= state._bucketSize) {
    state.throughput.push(state._bucketCompleted);
    if (state.throughput.length > 30) state.throughput.shift();
    state._bucketTicks = 0;
    state._bucketCompleted = 0;
  }
}

export function tick(state: SimulationState = getStore()): SimulationState {
  state.tick += 1;
  state._justCompleted = 0;
  const bus = new MessageBus();

  maybeAnnounceTask(state);
  runAuctions(state, bus);
  checkArrivals(state);
  handleBatteryAndCharging(state);
  resolveMovement(state, bus);
  checkArrivals(state);
  pruneOldTasks(state);
  decayHeat(state);
  updateThroughput(state);
  recomputeMetrics(state);

  return state;
}

// --- Fleet control actions (start/pause/reset/kill/revive) ---------------

export function killRobot(state: SimulationState, robotId: string) {
  const robot = state.robots.find((r) => r.id === robotId);
  if (!robot || !robot.alive) return;
  robot.alive = false;
  robot.status = "dead";
  robot.path = [];
  if (robot.taskId) {
    const task = state.tasks.find((t) => t.id === robot.taskId);
    if (task) {
      task.status = "announced";
      task.assignedTo = null;
      task.assignedTick = null;
      task.bids = [];
      task.createdTick = state.tick;
      logMessage(
        state,
        "task-orphaned",
        "system",
        `${task.id} orphaned by ${robot.name}'s failure — re-announced for bidding`,
        { taskId: task.id }
      );
    }
    robot.taskId = null;
  }
  logMessage(state, "robot-killed", robot.id, `${robot.name} taken offline — fleet must route around it`, {
    node: robot.node,
  });
}

export function reviveRobot(state: SimulationState, robotId: string) {
  const robot = state.robots.find((r) => r.id === robotId);
  if (!robot || robot.alive) return;
  robot.alive = true;
  robot.status = "idle";
  robot.battery = Math.max(robot.battery, 60);
  logMessage(state, "robot-revived", robot.id, `${robot.name} back online`, { node: robot.node });
}

export function killTaskServer(state: SimulationState) {
  if (!state.taskServerAlive) return;
  state.taskServerAlive = false;
  logMessage(
    state,
    "task-server-killed",
    "system",
    "Task server terminated — no new tasks will be announced, but the fleet keeps moving, bidding on already-open tasks, and avoiding collisions",
  );
}

export function reviveTaskServer(state: SimulationState) {
  if (state.taskServerAlive) return;
  state.taskServerAlive = true;
  state.nextTaskAt = state.tick + 3;
  logMessage(state, "task-server-revived", "system", "Task server back online");
}
