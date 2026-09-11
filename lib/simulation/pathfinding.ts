// A* over the warehouse adjacency graph. Grid is unweighted (every edge
// costs 1), so this is really "BFS with a heuristic," but A* is what scales
// if someone later adds weighted edges (e.g. slow zones near packing
// stations) without changing any caller.
import type { Warehouse, NodeId } from "@/lib/types";

function heuristic(w: Warehouse, a: NodeId, b: NodeId): number {
  const na = w.nodes[a];
  const nb = w.nodes[b];
  return Math.abs(na.x - nb.x) + Math.abs(na.y - nb.y);
}

/** Returns the shortest node path from start to goal, INCLUDING start. Empty array if unreachable. */
export function findPath(w: Warehouse, start: NodeId, goal: NodeId): NodeId[] {
  if (start === goal) return [start];

  const open = new Set<NodeId>([start]);
  const cameFrom = new Map<NodeId, NodeId>();
  const gScore = new Map<NodeId, number>([[start, 0]]);
  const fScore = new Map<NodeId, number>([[start, heuristic(w, start, goal)]]);

  while (open.size > 0) {
    let current: NodeId | null = null;
    let bestF = Infinity;
    for (const id of open) {
      const f = fScore.get(id) ?? Infinity;
      if (f < bestF) {
        bestF = f;
        current = id;
      }
    }
    if (current === null) break;
    if (current === goal) {
      const path: NodeId[] = [current];
      while (cameFrom.has(current)) {
        current = cameFrom.get(current)!;
        path.unshift(current);
      }
      return path;
    }
    open.delete(current);
    const neighbors = w.adjacency[current] ?? [];
    for (const n of neighbors) {
      const tentativeG = (gScore.get(current) ?? Infinity) + 1;
      if (tentativeG < (gScore.get(n) ?? Infinity)) {
        cameFrom.set(n, current);
        gScore.set(n, tentativeG);
        fScore.set(n, tentativeG + heuristic(w, n, goal));
        open.add(n);
      }
    }
  }
  return []; // unreachable
}

export function pathLength(w: Warehouse, start: NodeId, goal: NodeId): number {
  const p = findPath(w, start, goal);
  return p.length === 0 ? Infinity : p.length - 1;
}
