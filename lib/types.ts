// Shared types for the simulation engine, API routes, and dashboard UI.
// Kept in one file so server.ts, the app/api/* route handlers, and the
// React components all agree on the same shape of the world.

export type NodeId = number;

export interface WarehouseNode {
  id: NodeId;
  x: number; // grid column
  y: number; // grid row
  kind: "aisle" | "chokepoint" | "dock" | "charge";
  /** Human-readable name ("Dock A", "Charge Bay 2", "Zone 5") for dock/charge/
   * chokepoint nodes — set by buildWarehouse(), see labelWarehouseNodes().
   * Plain aisle nodes are too numerous to be worth naming and stay undefined.
   * This is what lets a person (or an LLM parsing free text) say "bring it
   * to Dock B" instead of "node 42". */
  label?: string;
}

export interface WarehouseEdge {
  from: NodeId;
  to: NodeId;
}

export interface Warehouse {
  cols: number;
  rows: number;
  nodes: WarehouseNode[];
  edges: WarehouseEdge[];
  /** adjacency list built once at init for fast pathfinding/local planning */
  adjacency: Record<NodeId, NodeId[]>;
}

/** Options accepted by buildWarehouse() — cols/rows are configurable so a
 * scenario preset (see lib/simulation/scenarios.ts) can size the floor to
 * its fleet instead of every deployment sharing one fixed footprint. */
export interface WarehouseOptions {
  cols?: number;
  rows?: number;
}

export type RobotStatus = "idle" | "bidding" | "moving" | "charging" | "dead";

export interface Robot {
  id: string;
  name: string;
  color: string;
  node: NodeId; // current position
  path: NodeId[]; // remaining nodes to traverse, path[0] is next hop
  status: RobotStatus;
  battery: number; // 0-100
  taskId: string | null;
  alive: boolean;
  waitTicks: number; // ticks spent yielding this task (for the dashboard + metrics)
}

export type TaskStatus =
  | "announced"
  | "assigned"
  | "en_route_pickup"
  | "en_route_dropoff"
  | "completed"
  | "orphaned";

export interface Task {
  id: string;
  pickup: NodeId;
  dropoff: NodeId;
  status: TaskStatus;
  assignedTo: string | null;
  /** Priority tasks (STAT medication, a stalled line, a time-critical container move)
   * get first pick of the idle robot pool each tick — see auction.ts's runAuctions. */
  urgent: boolean;
  createdTick: number;
  assignedTick: number | null;
  completedTick: number | null;
  bids: { robotId: string; cost: number }[];
}

export type MessageType =
  | "task-announced"
  | "bid"
  | "task-assigned"
  | "intent"
  | "yield"
  | "collision-avoided"
  | "task-picked"
  | "task-completed"
  | "task-orphaned"
  | "robot-killed"
  | "robot-revived"
  | "task-server-killed"
  | "task-server-revived"
  | "edge-inference"
  | "sim-reset"
  | "sim-start"
  | "sim-pause";

export interface MessageLogEntry {
  id: number;
  tick: number;
  type: MessageType;
  from: string; // robot id, "task-server", or "system"
  text: string;
  payload?: Record<string, unknown>;
}

export interface EdgeInferenceReading {
  robotId: string;
  latencyMs: number;
  detections: number;
  model: string;
  receivedAtTick: number;
}

export interface MetricsSnapshot {
  tick: number;
  collisionsAvoided: number;
  tasksCompleted: number;
  tasksInProgress: number;
  messagesLastSecond: number;
  avgBidLatencyTicks: number;
  avgInferenceLatencyMs: number;
  activeRobotCount: number;
  totalRobotCount: number;
  /** Completed-tasks-per-bucket rolling history (see recomputeMetrics / updateThroughput). */
  throughput: number[];
  /** Most recent throughput bucket — "tasks/bucket" at the current moment. */
  currentRate: number;
  /** Count of still-open (non-completed) urgent tasks. */
  urgentOpen: number;
}

export interface SimulationState {
  tick: number;
  running: boolean;
  taskServerAlive: boolean;
  warehouse: Warehouse;
  robots: Robot[];
  tasks: Task[];
  messages: MessageLogEntry[]; // ring buffer, most recent last
  edgeInference: EdgeInferenceReading[]; // ring buffer
  metrics: MetricsSnapshot;
  nextTaskAt: number; // tick at which the task server should announce the next task

  // --- scenario-tunable parameters (a domain preset adjusts these; see scenarios.ts) ---
  urgencyRatio: number; // fraction of newly-created tasks flagged urgent when not specified explicitly
  taskMinGap: number;
  taskMaxGap: number;
  maxOpenTasks: number;
  /** Which named preset (see lib/simulation/scenarios.ts) this run was booted/reset
   * into, or null for the plain, unlabeled default. Purely descriptive — never read
   * by the engine — it only lets the dashboard show "Hospital logistics" instead of
   * a generic fleet, and lets a scenario picker highlight the active choice. */
  scenarioKey: string | null;

  // --- congestion heat map: nodeId -> heat, bumped on blocked moves / contended
  // idle cells, decayed a little every tick. Purely a metrics/visualization signal —
  // never read by pathfinding or the auction, so it can't change simulation outcomes.
  heat: Record<NodeId, number>;

  // --- throughput bucketing (tasks completed per _bucketSize ticks) ---
  throughput: number[];
  _bucketSize: number;
  _bucketTicks: number;
  _bucketCompleted: number;
  _justCompleted: number;

  /** Monotonic task-id counter, kept ON the state object (not a module-level
   * `let`) so it survives Next.js dev-mode module reloading: server.ts (run
   * through tsx, its own module graph) and app/api/*\/route.ts (compiled by
   * Next's own SWC/webpack pipeline) can each get a separate instance of
   * taskServer.ts, and a plain module-scoped counter would silently reset
   * in one of them and hand out duplicate task ids. See lib/state/store.ts's
   * globalThis comment for the same class of bug on the store itself. */
  _taskCounter: number;
}

/** Snapshot sent to the browser over WS/HTTP — trims log history to keep payloads small. */
export interface StatePayload {
  tick: number;
  running: boolean;
  taskServerAlive: boolean;
  warehouse: Warehouse;
  robots: Robot[];
  tasks: Task[];
  messages: MessageLogEntry[];
  edgeInference: EdgeInferenceReading[];
  metrics: MetricsSnapshot;
  heat: Record<NodeId, number>;
  scenarioKey: string | null;
}
