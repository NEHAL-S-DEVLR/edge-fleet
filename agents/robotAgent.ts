#!/usr/bin/env -S npx tsx
// One robot's decision logic, running as its own OS process — the literal
// version of FR2. This process:
//   - owns nothing but a UDP socket, its own robot id, and (after the
//     coordinator's one-time "welcome") a copy of the static warehouse
//     graph — the same thing a real robot would carry as its onboard map.
//   - never reads lib/state/store.ts, never imports anything from
//     lib/transport/coordinator.ts, and has no way to see another robot's
//     state except whatever the coordinator chooses to broadcast publicly
//     (its own position/battery/status and the list of open tasks).
//   - computes its own bids with bidCost() and its own next-hop move
//     intent with planPath() — imported from lib/simulation/robot.ts, the
//     EXACT functions the in-process build uses, so "the algorithm" is
//     provably identical across both transports.
//
// Run standalone: npx tsx agents/robotAgent.ts --id r1 --port 4101
// Normally launched by scripts/distributed-demo.ts, one child process per
// robot — see that file, or `npm run demo:distributed`.
import dgram from "node:dgram";
import type { NodeId, Warehouse } from "@/lib/types";
import { bidCost, planPath } from "@/lib/simulation/robot";
import { DEFAULT_COORDINATOR_PORT, decode, encode, type AnyMsg } from "@/lib/transport/protocol";

function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx === process.argv.length - 1) return fallback;
  return process.argv[idx + 1];
}

const robotId = arg("id");
const myPort = Number(arg("port"));
const coordinatorPort = Number(arg("coordinator-port", String(DEFAULT_COORDINATOR_PORT)));
const coordinatorHost = arg("coordinator-host", "127.0.0.1")!;
const quiet = process.argv.includes("--quiet");

if (!robotId || !myPort) {
  console.error("usage: robotAgent.ts --id <robotId> --port <udpPort> [--coordinator-port 4000] [--coordinator-host 127.0.0.1] [--quiet]");
  process.exit(1);
}

function log(line: string) {
  if (!quiet) console.log(`[${robotId}] ${line}`);
}

let warehouse: Warehouse | null = null;
let currentTarget: NodeId | null = null;
let registered = false;

const socket = dgram.createSocket("udp4");
socket.on("error", (e: NodeJS.ErrnoException) => {
  // A bind failure (almost always EADDRINUSE — a stale process from a
  // previous run still squatting on this port) is fatal and must stay
  // visible even with --quiet, which only silences normal progress output.
  if (e.code === "EADDRINUSE" || e.code === "EACCES") {
    console.error(`[${robotId}] fatal: cannot bind udp://127.0.0.1:${myPort} (${e.code}) — is a previous run still running?`);
    process.exit(1);
  }
  log(`socket error (non-fatal): ${e.message}`);
});

function send(msg: AnyMsg) {
  socket.send(encode(msg), coordinatorPort, coordinatorHost, (err) => {
    if (err) log(`send failed (non-fatal): ${err.message}`);
  });
}

function registerWithCoordinator() {
  send({ type: "register", robotId: robotId!, port: myPort });
}

socket.on("message", (buf) => {
  const msg = decode(buf);
  if (!msg) return;

  if (msg.type === "welcome") {
    warehouse = msg.warehouse;
    registered = true;
    log(`registered — received warehouse graph (${msg.warehouse.nodes.length} nodes), tick ${msg.tickMs}ms`);
    return;
  }

  if (msg.type === "directive") {
    currentTarget = msg.target;
    log(`directive: head to node ${msg.target} (${msg.reason}${msg.taskId ? ` ${msg.taskId}` : ""})`);
    return;
  }

  if (msg.type === "tick") {
    if (!warehouse) return; // haven't received the graph yet — nothing to compute against
    if (msg.target !== null) currentTarget = msg.target;
    else if (msg.status === "idle") currentTarget = null;

    let saidSomething = false;

    // Bid on every open task while idle — computeBidCost() ported nowhere,
    // imported verbatim as bidCost() from lib/simulation/robot.ts.
    if (msg.status === "idle" && msg.openTasks.length > 0) {
      for (const task of msg.openTasks) {
        const cost = bidCost(warehouse, msg.node, msg.battery, task.pickup);
        if (!Number.isFinite(cost)) continue;
        send({ type: "bid", robotId: robotId!, taskId: task.id, cost });
        saidSomething = true;
      }
    }

    // Publish this tick's move intent, if we're headed anywhere. Replanning
    // fresh from the authoritative position every tick (rather than caching
    // a path) makes this robust to a dropped datagram or a blocked move —
    // exactly the retry behavior a real robot's local planner would show.
    if (currentTarget !== null && currentTarget !== msg.node) {
      const path = planPath(warehouse, msg.node, currentTarget);
      if (path.length > 0) {
        send({ type: "intent", robotId: robotId!, fromNode: msg.node, toNode: path[0] });
        saidSomething = true;
      }
    }

    // Idle with nothing to bid on: still prove we're alive, or the
    // coordinator's liveness timeout eventually mistakes "quiet" for "dead".
    if (!saidSomething) send({ type: "heartbeat", robotId: robotId! });
    return;
  }
});

socket.bind(myPort, () => {
  log(`listening on udp://127.0.0.1:${myPort}, registering with coordinator at udp://${coordinatorHost}:${coordinatorPort}`);
  registerWithCoordinator();
  // Coordinator's own datagram could in principle arrive before it's bound/
  // ready, or the register packet could be dropped (UDP has no delivery
  // guarantee) — retry a few times until the welcome arrives.
  let attempts = 0;
  const retry = setInterval(() => {
    attempts++;
    if (registered || attempts > 20) {
      clearInterval(retry);
      return;
    }
    registerWithCoordinator();
  }, 500);
});

process.on("SIGINT", () => {
  log("shutting down");
  socket.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  socket.close();
  process.exit(0);
});
