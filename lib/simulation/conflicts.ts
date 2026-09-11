// The movement conflict-resolution rule — head-on swaps and same-target
// contention — extracted as a pure function of (intents, wait-priority,
// static occupancy) with no dependency on SimulationState or the
// MessageBus. This is deliberate: it's the "public, deterministic rule"
// lib/simulation/auction.ts's header comment talks about for bidding, and
// it needed the same treatment — any process holding a batch of move
// intents (in-process, from the MessageBus, or received over real UDP
// datagrams from separate OS processes — see lib/transport/) can call this
// exact function and reach the identical answer. engine.ts's resolveMovement
// is now a thin wrapper: collect intents, call this, apply the verdict.
import type { NodeId } from "@/lib/types";

export interface MoveIntent {
  robotId: string;
  fromNode: NodeId;
  toNode: NodeId;
}

/**
 * Returns the set of robotIds that must yield this round.
 *
 * - Head-on swap (A -> B while B -> A on the same edge): the robot that has
 *   been waiting longer wins; ties broken by robot id (lexicographically
 *   smaller wins) so the outcome is fully deterministic, not "whoever asked
 *   first" (which would depend on network/scheduling timing — exactly the
 *   kind of race a real distributed system can't rely on).
 * - Same-target contention, or a target statically held by a robot that
 *   isn't moving this round: same wait-priority rule.
 */
export function resolveMovementConflicts(
  intents: MoveIntent[],
  waitTicksOf: (robotId: string) => number,
  staticOccupied: ReadonlySet<NodeId>
): Set<string> {
  const blocked = new Set<string>();

  // head-on swaps: A -> B while B -> A on a single edge
  for (const i of intents) {
    if (blocked.has(i.robotId)) continue;
    const opposite = intents.find(
      (j) => j.robotId !== i.robotId && j.fromNode === i.toNode && j.toNode === i.fromNode
    );
    if (opposite) {
      const waitA = waitTicksOf(i.robotId);
      const waitB = waitTicksOf(opposite.robotId);
      const loserId =
        waitA === waitB ? (i.robotId > opposite.robotId ? i.robotId : opposite.robotId) : waitA < waitB ? i.robotId : opposite.robotId;
      blocked.add(loserId);
    }
  }

  // same-target conflicts, and targets that are statically occupied
  const byTarget = new Map<NodeId, MoveIntent[]>();
  for (const i of intents) {
    if (!byTarget.has(i.toNode)) byTarget.set(i.toNode, []);
    byTarget.get(i.toNode)!.push(i);
  }
  for (const [target, list] of byTarget) {
    if (staticOccupied.has(target)) {
      for (const i of list) blocked.add(i.robotId);
      continue;
    }
    if (list.length > 1) {
      let winner = list[0];
      for (const i of list) {
        const rWait = waitTicksOf(i.robotId);
        const wWait = waitTicksOf(winner.robotId);
        if (rWait > wWait || (rWait === wWait && i.robotId < winner.robotId)) {
          winner = i;
        }
      }
      for (const i of list) if (i.robotId !== winner.robotId) blocked.add(i.robotId);
    }
  }

  return blocked;
}
