// Wire format for the real distributed transport (see coordinator.ts and
// ../../agents/robotAgent.ts). Every message is one JSON object in one UDP
// datagram — no framing needed, UDP already delivers whole packets or not
// at all. This is the literal, over-a-real-socket version of the same two
// message topics lib/simulation/messageBus.ts defines for the in-process
// build ("bid", "intent") plus the handful of control messages a real
// transport needs that an in-process function call doesn't: registration
// (an agent has to tell the coordinator which port to reach it on — there's
// no shared memory to just look it up), the one-time world/graph handoff,
// and directives (the coordinator telling an agent where it's now headed).
import type { NodeId, Warehouse } from "@/lib/types";

export const DEFAULT_COORDINATOR_PORT = 4000;
export const DEFAULT_AGENT_BASE_PORT = 4101;

// ---- Agent -> Coordinator -------------------------------------------------

export interface RegisterMsg {
  type: "register";
  robotId: string;
  port: number;
}

export interface BidMsg {
  type: "bid";
  robotId: string;
  taskId: string;
  cost: number;
}

export interface IntentMsg {
  type: "intent";
  robotId: string;
  fromNode: NodeId;
  toNode: NodeId;
}

/** Sent once per tick even when a robot has nothing else to report (idle,
 * no open tasks) — a bid or an intent already proves liveness on its own,
 * but "nothing to bid on right now" needs its own signal, or the
 * coordinator's liveness timeout (lib/transport/coordinator.ts) can't tell
 * a quiet-but-alive robot from a genuinely dead one. */
export interface HeartbeatMsg {
  type: "heartbeat";
  robotId: string;
}

export type AgentToCoordinatorMsg = RegisterMsg | BidMsg | IntentMsg | HeartbeatMsg;

// ---- Coordinator -> Agent --------------------------------------------------

export interface WelcomeMsg {
  type: "welcome";
  robotId: string;
  warehouse: Warehouse;
  tickMs: number;
}

export interface OpenTaskSummary {
  id: string;
  pickup: NodeId;
  urgent: boolean;
  createdTick: number;
}

export interface TickMsg {
  type: "tick";
  tick: number;
  node: NodeId;
  battery: number;
  status: "idle" | "moving" | "charging" | "dead";
  /** Only present when this robot currently has somewhere to be (see
   * DirectiveMsg) — lets a just-started agent process recover its target
   * after a restart without the coordinator resending a directive. */
  target: NodeId | null;
  openTasks: OpenTaskSummary[];
}

export interface DirectiveMsg {
  type: "directive";
  robotId: string;
  target: NodeId;
  reason: "task-pickup" | "task-dropoff" | "charge";
  taskId?: string;
}

export type CoordinatorToAgentMsg = WelcomeMsg | TickMsg | DirectiveMsg;

export type AnyMsg = AgentToCoordinatorMsg | CoordinatorToAgentMsg;

export function encode(msg: AnyMsg): Buffer {
  return Buffer.from(JSON.stringify(msg), "utf8");
}

export function decode(buf: Buffer): AnyMsg | null {
  try {
    const parsed = JSON.parse(buf.toString("utf8"));
    if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
      return parsed as AnyMsg;
    }
    return null;
  } catch {
    return null;
  }
}
