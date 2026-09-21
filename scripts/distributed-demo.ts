#!/usr/bin/env -S npx tsx
// Launches the real distributed transport end to end: one coordinator
// (this process) plus N separate `agents/robotAgent.ts` child processes —
// one per robot, each a real OS process talking to the coordinator only
// over real UDP sockets on localhost. `ps aux | grep robotAgent` while
// this runs shows the separate PIDs; --log-file additionally writes one
// JSON line per tick with live wire counters (datagrams sent/received,
// bids/intents that tick) so the traffic can be verified after the fact
// without a packet sniffer.
//
// Usage:
//   npm run demo:distributed
//   npm run demo:distributed -- --robots 6 --ticks 40 --scenario hospital
//   npm run demo:distributed -- --ticks 80 --kill-robot r3 --kill-at-tick 20 --revive-robot r3 --revive-at-tick 50
//   npm run demo:distributed -- --ticks 120 --packet-loss 0.15 --latency-ms 40 --latency-jitter-ms 60
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DistributedCoordinator } from "@/lib/transport/coordinator";
import { DEFAULT_AGENT_BASE_PORT, DEFAULT_COORDINATOR_PORT } from "@/lib/transport/protocol";
import { getScenario } from "@/lib/simulation/scenarios";

// Spawn node directly with tsx's own loader flags, rather than through the
// `tsx` binary (and doubly not through `npx`). Both of those interpose a
// wrapper process: `npx` goes npm exec -> sh -c -> tsx bin -> real node
// process, and even the locally installed tsx bin (node_modules/.bin/tsx)
// itself forks a *second* node process internally to actually run the file
// under its loader hooks. A SIGKILL sent to the outer wrapper's PID does
// NOT propagate to that inner process — it just gets reparented to init and
// keeps running, still bound to its fixed UDP port, fully alive. This was
// caught directly: killing the tsx-bin child left the real agent process
// (verified via `ps -ef` — it showed up with ppid 1) still registered with
// the coordinator, still bidding, still completing tasks, and a later
// --revive-robot spawn for the same id then failed with EADDRINUSE because
// the "killed" agent was never actually dead.
//
// The fix: invoke node with the exact --require/--import flags tsx's own
// bin uses (verified by inspecting the live process tree) so the process
// `spawn()` returns a handle to IS the real agent process, one single PID,
// no wrapper layer to lose a signal in.
const NODE_BIN = process.execPath;
const TSX_PREFLIGHT = path.join(__dirname, "..", "node_modules", "tsx", "dist", "preflight.cjs");
const TSX_LOADER = "file://" + path.join(__dirname, "..", "node_modules", "tsx", "dist", "loader.mjs");

function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx === process.argv.length - 1) return fallback;
  return process.argv[idx + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const stopAfterTicks = arg("ticks") ? Number(arg("ticks")) : undefined;
const tickMs = Number(arg("tick-ms", "300"));
const coordinatorPort = Number(arg("coordinator-port", String(DEFAULT_COORDINATOR_PORT)));
const scenarioKey = arg("scenario");
const logFile = arg("log-file", path.join(__dirname, "..", "distributed-demo.log.jsonl"))!;
const quietAgents = !flag("verbose-agents");

const scenario = scenarioKey ? getScenario(scenarioKey) : undefined;
const stateOptions = scenario ? (({ label, robotLabel, blurb, ...rest }) => rest)(scenario) : {};
// --robots explicitly overrides; otherwise defer to the scenario's own
// robotCount when a scenario was given, and fall back to 8 for neither.
const robotCount = Number(arg("robots") ?? stateOptions.robotCount ?? 8);

// Scripted kill-switch demo (FR7, the literal distributed version): at a
// given tick, actually SIGKILL that robot's real OS process — no API call,
// no in-process function, the process just stops existing — and watch the
// coordinator's liveness timeout notice the silence, orphan its task for
// re-auction, and the rest of the fleet route around it. --revive-robot
// spawns a fresh process for that robot id, same as swapping in a repaired
// machine.
const killRobotId = arg("kill-robot");
const killAtTick = arg("kill-at-tick") ? Number(arg("kill-at-tick")) : undefined;
const reviveRobotId = arg("revive-robot");
const reviveAtTick = arg("revive-at-tick") ? Number(arg("revive-at-tick")) : undefined;
const killTaskServerAtTick = arg("kill-task-server-at-tick") ? Number(arg("kill-task-server-at-tick")) : undefined;

// Simulated network degradation (PRD nice-to-have) — injected at the
// coordinator's own socket boundary (lib/transport/coordinator.ts), both
// directions, so it reproduces on any machine with no firewall/tc rules.
// --packet-loss 0.15 drops ~15% of datagrams outright; --latency-ms 40
// --latency-jitter-ms 60 adds 40-100ms of delay per datagram — enough,
// against the default ~150ms responseWindowMs, to start making bids and
// intents miss their tick's window and get silently discarded, which is
// the real mechanism (not a cosmetic counter) by which this should show up
// as fewer completions / more re-auctions in the metrics below.
const packetLossRate = arg("packet-loss") ? Number(arg("packet-loss")) : 0;
const latencyMs = arg("latency-ms") ? Number(arg("latency-ms")) : 0;
const latencyJitterMs = arg("latency-jitter-ms") ? Number(arg("latency-jitter-ms")) : 0;

writeFileSync(logFile, ""); // truncate/start fresh for this run

console.log(`\n  EdgeFleet — real distributed transport demo`);
console.log(`  Coordinator: udp://127.0.0.1:${coordinatorPort}  ·  ${robotCount} robot processes  ·  tick ${tickMs}ms`);
if (packetLossRate > 0 || latencyMs > 0 || latencyJitterMs > 0) {
  console.log(
    `  Degradation: ${(packetLossRate * 100).toFixed(0)}% packet loss  ·  ${latencyMs}ms latency (+${latencyJitterMs}ms jitter)`
  );
}
console.log(`  Verification log: ${logFile}\n`);

// Rolling window of drop-rate-per-tick, rendered as a live ASCII sparkline
// alongside the periodic console summary below — the "live degradation
// graph" for a transport that has no browser dashboard of its own.
const DROP_HISTORY_LEN = 40;
const dropRateHistory: number[] = [];
const SPARK_CHARS = "▁▂▃▄▅▆▇█";
function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(0.01, ...values);
  return values.map((v) => SPARK_CHARS[Math.min(SPARK_CHARS.length - 1, Math.floor((v / max) * (SPARK_CHARS.length - 1)))]).join("");
}

const coordinator = new DistributedCoordinator({
  ...stateOptions,
  robotCount,
  port: coordinatorPort,
  tickMs,
  packetLossRate,
  latencyMs,
  latencyJitterMs,
  onLog: (line) => console.log(`  ${line}`),
  onTick: (state, wire) => {
    const totalThisTick = wire.bidsThisTick + wire.intentsThisTick + wire.droppedThisTick + wire.delayedThisTick;
    const dropRateThisTick = totalThisTick > 0 ? wire.droppedThisTick / totalThisTick : 0;
    dropRateHistory.push(dropRateThisTick);
    if (dropRateHistory.length > DROP_HISTORY_LEN) dropRateHistory.shift();

    const record = {
      ts: Date.now(),
      tick: state.tick,
      datagramsSent: wire.datagramsSent,
      datagramsReceived: wire.datagramsReceived,
      bidsThisTick: wire.bidsThisTick,
      intentsThisTick: wire.intentsThisTick,
      datagramsDropped: wire.datagramsDropped,
      droppedThisTick: wire.droppedThisTick,
      delayedThisTick: wire.delayedThisTick,
      tasksCompleted: state.metrics.tasksCompleted,
      collisionsAvoided: state.metrics.collisionsAvoided,
      activeRobots: state.metrics.activeRobotCount,
    };
    appendFileSync(logFile, JSON.stringify(record) + "\n");
    if (state.tick % 10 === 0) {
      const degradationSuffix =
        packetLossRate > 0 || latencyMs > 0 || latencyJitterMs > 0
          ? ` | dropped ${wire.datagramsDropped} total (${wire.droppedThisTick} this tick, ${wire.delayedThisTick} delayed) [${sparkline(
              dropRateHistory
            )}]`
          : "";
      console.log(
        `  tick ${state.tick.toString().padStart(4)} | datagrams sent ${wire.datagramsSent} / received ${wire.datagramsReceived}` +
          ` | this tick: ${wire.bidsThisTick} bid(s), ${wire.intentsThisTick} intent(s) | completed ${state.metrics.tasksCompleted}` +
          ` | collisions avoided ${state.metrics.collisionsAvoided}${degradationSuffix}`
      );
    }
    if (killRobotId && killAtTick && state.tick === killAtTick) {
      console.log(`\n  --kill-robot: sending SIGKILL to ${killRobotId}'s real OS process (pid ${agentPids.get(killRobotId)}) at tick ${state.tick}\n`);
      killAgentProcess(killRobotId);
      // deliberately NOT calling coordinator.killRobot() here — the whole
      // point is proving the coordinator notices on its own, from silence,
      // the way it would for a genuine hardware failure it wasn't told about.
    }
    if (reviveRobotId && reviveAtTick && state.tick === reviveAtTick) {
      console.log(`\n  --revive-robot: spawning a fresh OS process for ${reviveRobotId} at tick ${state.tick}\n`);
      spawnAgent(reviveRobotId);
      coordinator.reviveRobot(reviveRobotId);
    }
    if (killTaskServerAtTick && state.tick === killTaskServerAtTick) {
      console.log(`\n  --kill-task-server-at-tick: killing task announcements at tick ${state.tick}\n`);
      coordinator.killTaskServerAnnouncements();
    }

    if (stopAfterTicks && state.tick >= stopAfterTicks) {
      console.log(`\n  reached --ticks ${stopAfterTicks}, shutting down`);
      shutdown(0);
    }
  },
});

coordinator.start();

const agentProcesses: ChildProcess[] = [];
const agentPids = new Map<string, number | undefined>();
const agentPorts = new Map<string, number>();

function spawnAgent(robotId: string): ChildProcess {
  const port = agentPorts.get(robotId) ?? DEFAULT_AGENT_BASE_PORT + coordinator.state.robots.findIndex((r) => r.id === robotId);
  agentPorts.set(robotId, port);
  const args = [
    "--require",
    TSX_PREFLIGHT,
    "--import",
    TSX_LOADER,
    path.join(__dirname, "..", "agents", "robotAgent.ts"),
    "--id",
    robotId,
    "--port",
    String(port),
    "--coordinator-port",
    String(coordinatorPort),
  ];
  if (quietAgents) args.push("--quiet");
  // Bind failures (e.g. a stale process still squatting on this port from a
  // prior run) must stay visible even in quiet mode — "ignore" would hide
  // exactly the failure that most needs to be seen, so pipe stderr through.
  const child = spawn(NODE_BIN, args, { stdio: quietAgents ? ["ignore", "ignore", "inherit"] : "inherit" });
  agentPids.set(robotId, child.pid);
  child.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`  ! agent ${robotId} (pid ${child.pid}) exited with code ${code}`);
    } else if (signal && signal !== "SIGTERM" && signal !== "SIGKILL") {
      console.error(`  ! agent ${robotId} (pid ${child.pid}) killed by ${signal}`);
    }
  });
  agentProcesses.push(child);
  return child;
}

function killAgentProcess(robotId: string) {
  const child = agentProcesses.find((c) => agentPids.get(robotId) === c.pid);
  child?.kill("SIGKILL");
}

for (let i = 0; i < robotCount; i++) {
  spawnAgent(coordinator.state.robots[i].id);
}

function shutdown(code: number) {
  coordinator.stop();
  for (const child of agentProcesses) child.kill("SIGTERM");
  // Defense in depth: SIGTERM should be enough now that agents are spawned
  // directly (see TSX_BIN above), but force-kill anything still alive after
  // a grace period rather than risk another run inheriting a stale process
  // squatting on a fixed agent port.
  setTimeout(() => {
    for (const child of agentProcesses) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, 500);
  setTimeout(() => process.exit(code), 800);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
