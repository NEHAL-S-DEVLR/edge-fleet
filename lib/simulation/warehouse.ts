// Builds the static warehouse floor graph and the initial simulation state.
//
// Layout: a cols x rows grid (default 15x10). Odd columns are shelving
// racks (unwalkable) except on cross-aisle rows, which are full-width
// highways. Cross-aisle rows are every 3rd row plus the last row, which
// produces the classic warehouse shape — vertical picking aisles between
// racks, tied together by horizontal cross-aisles — and puts real
// chokepoints at every cross-aisle / picking-aisle intersection, exactly
// where robots are forced to negotiate right-of-way.
//
// Charging/dock bays are distributed along the top and bottom highways
// instead of parked in two corners: every 4th chokepoint alternates
// charge/dock/plain. A bigger fleet (12-16 robots) needs more than one
// shared corner charger, the same reason real fulfillment centers scatter
// charging pods across the floor rather than using a single bay.
import type { Warehouse, WarehouseNode, WarehouseEdge, WarehouseOptions, Robot, SimulationState, NodeId } from "@/lib/types";

const DEFAULT_COLS = 15;
const DEFAULT_ROWS = 10;

function crossAisleRows(rows: number): Set<number> {
  const set = new Set<number>();
  for (let y = 0; y < rows; y++) {
    if (y % 3 === 0 || y === rows - 1) set.add(y);
  }
  return set;
}

export function buildWarehouse(options: WarehouseOptions = {}): Warehouse {
  const cols = options.cols ?? DEFAULT_COLS;
  const rows = options.rows ?? DEFAULT_ROWS;
  const crossRows = crossAisleRows(rows);

  const nodeExists = (x: number, y: number): boolean => {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return false;
    if (crossRows.has(y)) return true; // full-width cross aisle
    return x % 2 === 0; // picking aisle column
  };

  /** Every 4th top/bottom-highway chokepoint alternates charge/dock/plain,
   * so charging and docking bays are spread across the perimeter rather
   * than shared by two corners. */
  const edgeStationKind = (x: number, y: number): "charge" | "dock" | null => {
    if (y !== 0 && y !== rows - 1) return null;
    if (x % 2 !== 0) return null;
    const idx = x / 2;
    if (idx % 4 === 0) return "charge";
    if (idx % 4 === 2) return "dock";
    return null;
  };

  const nodes: WarehouseNode[] = [];
  const idOf = new Map<string, NodeId>();

  let id = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!nodeExists(x, y)) continue;
      const isIntersection = crossRows.has(y) && x % 2 === 0;
      let kind: WarehouseNode["kind"] = "aisle";
      if (isIntersection) kind = "chokepoint";
      const station = edgeStationKind(x, y);
      if (station) kind = station;
      nodes.push({ id, x, y, kind });
      idOf.set(`${x},${y}`, id);
      id++;
    }
  }

  const edges: WarehouseEdge[] = [];
  const adjacency: Record<NodeId, NodeId[]> = {};
  for (const n of nodes) adjacency[n.id] = [];

  const tryLink = (x1: number, y1: number, x2: number, y2: number) => {
    const a = idOf.get(`${x1},${y1}`);
    const b = idOf.get(`${x2},${y2}`);
    if (a === undefined || b === undefined) return;
    edges.push({ from: a, to: b });
    adjacency[a].push(b);
    adjacency[b].push(a);
  };

  for (const n of nodes) {
    tryLink(n.x, n.y, n.x + 1, n.y);
    tryLink(n.x, n.y, n.x, n.y + 1);
  }

  return { cols, rows, nodes, edges, adjacency };
}

export const ROBOT_COLORS = [
  "#ff8248", // accent
  "#3fbdb7", // edge
  "#d9a53c", // warn
  "#5aab6b", // good
  "#8a7cff",
  "#e0584f",
  "#4fa3ff",
  "#c86bd6",
  "#c98a2c",
  "#3f9e6d",
  "#e0648f",
  "#5c8fe0",
  "#b0a13f",
  "#e08a3f",
  "#4fb0a5",
  "#9a6bd6",
];

export const ROBOT_NAMES = [
  "AMR-01",
  "AMR-02",
  "AMR-03",
  "AMR-04",
  "AMR-05",
  "AMR-06",
  "AMR-07",
  "AMR-08",
  "AMR-09",
  "AMR-10",
  "AMR-11",
  "AMR-12",
  "AMR-13",
  "AMR-14",
  "AMR-15",
  "AMR-16",
];

export const MAX_ROBOTS = ROBOT_NAMES.length;

/** Spread starting positions across cross-aisle nodes so robots begin apart from each other. */
function pickStartNodes(w: Warehouse, count: number): NodeId[] {
  const candidates = w.nodes.filter((n) => n.kind === "chokepoint" || n.kind === "dock" || n.kind === "charge");
  const chosen: NodeId[] = [];
  const step = Math.max(1, Math.floor(candidates.length / count));
  for (let i = 0; i < count && i * step < candidates.length; i++) {
    chosen.push(candidates[i * step].id);
  }
  while (chosen.length < count) chosen.push(candidates[chosen.length % candidates.length].id);
  return chosen;
}

const DEFAULT_MIN_GAP = 14;
const DEFAULT_MAX_GAP = 30;
const DEFAULT_MAX_OPEN = 6;
const DEFAULT_URGENCY_RATIO = 0.18;

/** Options accepted by createInitialState() — this is also the shape a
 * scenario preset (lib/simulation/scenarios.ts) fills in. */
export interface CreateStateOptions extends WarehouseOptions {
  robotCount?: number;
  urgencyRatio?: number;
  taskMinGap?: number;
  taskMaxGap?: number;
  maxOpenTasks?: number;
}

export function createInitialState(options: CreateStateOptions = {}): SimulationState {
  const warehouse = buildWarehouse(options);
  const robotCount = Math.max(1, Math.min(MAX_ROBOTS, options.robotCount ?? 8));
  const starts = pickStartNodes(warehouse, robotCount);

  const robots: Robot[] = starts.map((node, i) => ({
    id: `r${i + 1}`,
    name: ROBOT_NAMES[i],
    color: ROBOT_COLORS[i % ROBOT_COLORS.length],
    node,
    path: [],
    status: "idle",
    battery: 85 + Math.round(Math.random() * 15),
    taskId: null,
    alive: true,
    waitTicks: 0,
  }));

  return {
    tick: 0,
    running: false,
    taskServerAlive: true,
    warehouse,
    robots,
    tasks: [],
    messages: [],
    edgeInference: [],
    metrics: {
      tick: 0,
      collisionsAvoided: 0,
      tasksCompleted: 0,
      tasksInProgress: 0,
      messagesLastSecond: 0,
      avgBidLatencyTicks: 0,
      avgInferenceLatencyMs: 0,
      activeRobotCount: robotCount,
      totalRobotCount: robotCount,
      throughput: [],
      currentRate: 0,
      urgentOpen: 0,
    },
    nextTaskAt: 3,

    urgencyRatio: options.urgencyRatio ?? DEFAULT_URGENCY_RATIO,
    taskMinGap: options.taskMinGap ?? DEFAULT_MIN_GAP,
    taskMaxGap: options.taskMaxGap ?? DEFAULT_MAX_GAP,
    maxOpenTasks: options.maxOpenTasks ?? DEFAULT_MAX_OPEN,

    heat: {},

    throughput: [],
    _bucketSize: 20,
    _bucketTicks: 0,
    _bucketCompleted: 0,
    _justCompleted: 0,
  };
}
