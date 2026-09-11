// Decentralized task allocation via a lightweight Contract Net Protocol.
//
// There is no dispatcher assigning robots to work. Every idle robot
// independently computes its own cost for an announced task and publishes
// a bid onto the message bus. `resolveAuctions` is a *public, deterministic
// rule* — lowest cost wins, ties broken by robot id — not a decision-maker
// with discretion. Every robot in the fleet could run this exact same
// function over the same published bids and arrive at the identical
// answer; it's a protocol, the same way "yield to the vehicle on your
// right" is a protocol, not an authority.
import type { SimulationState, Task } from "@/lib/types";
import { computeBidCost, planPathTo } from "@/lib/simulation/robot";
import { logMessage } from "@/lib/state/store";
import type { MessageBus } from "@/lib/simulation/messageBus";

/** The auction's actual "public, deterministic rule": lowest cost wins,
 * ties broken by robot id. Pure function of whatever bids showed up — it
 * doesn't care whether they arrived over the in-process MessageBus or over
 * real UDP datagrams from separate OS processes (lib/transport/), which is
 * exactly the point: any robot, or any coordinator process, running this
 * same function over the same published bids reaches the identical answer. */
export function pickWinningBid<B extends { robotId: string; cost: number }>(bids: B[]): B | undefined {
  if (bids.length === 0) return undefined;
  let winner = bids[0];
  for (const b of bids) {
    if (b.cost < winner.cost || (b.cost === winner.cost && b.robotId < winner.robotId)) {
      winner = b;
    }
  }
  return winner;
}

export function runAuctions(state: SimulationState, bus: MessageBus) {
  const openTasks = state.tasks.filter((t) => t.status === "announced");
  if (openTasks.length === 0) return;

  // Urgent tasks (STAT medication, a stalled production cell, a time-critical
  // container move) get first pick of the idle fleet each tick — the auction
  // rule itself is unchanged, only the order tasks get to draw idle bidders from.
  openTasks.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return a.createdTick - b.createdTick;
  });

  const idleRobots = state.robots.filter((r) => r.alive && r.status === "idle");

  for (const task of openTasks) {
    for (const robot of idleRobots) {
      const cost = computeBidCost(state, robot, task);
      if (!Number.isFinite(cost)) continue;
      task.bids.push({ robotId: robot.id, cost });
      bus.publish("bid", { robotId: robot.id, taskId: task.id, cost: Math.round(cost * 10) / 10 });
      logMessage(state, "bid", robot.id, `${robot.name} bids ${cost.toFixed(1)} for ${task.id}`, {
        taskId: task.id,
        cost,
      });
    }

    if (task.bids.length === 0) continue; // no eligible bidder yet, retry next tick

    const winner = pickWinningBid(task.bids)!;

    const robot = state.robots.find((r) => r.id === winner.robotId);
    if (!robot || robot.status !== "idle") continue; // already claimed elsewhere this tick

    task.status = "en_route_pickup";
    task.assignedTo = robot.id;
    task.assignedTick = state.tick;
    robot.status = "moving";
    robot.taskId = task.id;
    planPathTo(state, robot, task.pickup);

    logMessage(state, "task-assigned", robot.id, `${robot.name} wins ${task.id} (bid ${winner.cost.toFixed(1)}) — heading to pickup`, {
      taskId: task.id,
      robotId: robot.id,
    });
  }
}
