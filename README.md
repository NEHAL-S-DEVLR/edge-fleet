# EdgeFleet

A working Round-1 prototype for **SIH26123 — Edge-AI Based Distributed Fleet
Coordination for AMRs in Smart Warehouses.** A live multi-robot simulation
with decentralized task bidding, local collision avoidance, a real onboard
inference bridge, and a kill-switch resilience demo — all in one Next.js
app plus one small Python script.

```
npm install
cp .env.example .env
npm run dev
```

Then open **http://localhost:3000**. Click **Start**. Robots begin bidding
on tasks and moving; the dashboard updates live over WebSocket.

To run the edge-AI half:

```
cd edge-ai-bridge
pip install -r requirements.txt
python make_sample_frames.py      # one-time: generates demo frames
python edge_infer.py              # streams real inference latency to the dashboard
```

---

## What you're looking at

Three moving parts, deliberately kept separate so the "no single point of
failure" claim is checkable, not just asserted:

1. **The Next.js app** (`app/`, `components/`, `hooks/`) — the dashboard. Pure
   presentation; it has no simulation logic of its own.
2. **The simulation engine** (`lib/simulation/`, `lib/state/`, `lib/ws/`),
   run by `server.ts` — this *is* the fleet. A tick loop advances physics,
   runs a decentralized task auction, and resolves movement conflicts with
   a public, deterministic rule (not a discretionary scheduler). See
   **Architecture** below.
3. **`edge-ai-bridge/edge_infer.py`** — a standalone Python process that runs
   real on-device object detection and reports real latency numbers. It can
   run on the same laptop, or on a Raspberry Pi / Jetson Nano on the same
   network, without changing a line of the dashboard.

Open the **"How It Works"** button in the dashboard for the same explanation
aimed at a judge standing at your table.

---

## Real-World Applications

The coordination protocol — decentralized bidding, local collision
avoidance, survivable task-server/robot death — doesn't care what's on the
robots' forks. `lib/simulation/scenarios.ts` packages five deployment
presets (fleet size, urgent-task ratio, task cadence) that model real
operating environments this same engine maps onto directly:

- **E-commerce fulfillment** — a 14-AMR fleet shuttling totes from pick
  faces to pack stations, modeled on Amazon/Ocado-style fulfillment
  centers. Mostly steady-state traffic, occasional rush orders.
- **Hospital logistics** — 8 med-bots running linen and supply routes, with
  a high urgent-task ratio (0.4) because a STAT medication delivery has to
  cut the queue the way it would for a real hospital courier.
- **Port / container yard** — a 16-AGV fleet doing long, deliberate hauls
  between crane and stack, the automated-terminal pattern used at yards
  like Rotterdam and Qingdao. Low urgency (0.08), longer task gaps — this
  is the "many robots, few chokepoint conflicts under normal load" stress
  case for the collision rule.
- **Manufacturing line** — 10 line-bots on short, frequent hops feeding a
  production line; a starved station turns urgent fast (task gaps as low
  as 6 ticks).
- **Disaster response** — 12 rescue-bots at a relief staging depot, where
  most moves are treated as time-critical (urgency ratio 0.55) — this
  scenario is really a stress test of the urgent-task auction priority
  under sustained load.
- **Also applicable: agriculture** — the same auction/collision engine
  maps onto autonomous field robots coordinating harvest and transport
  runs between rows, where "chokepoints" are field access lanes instead of
  warehouse aisles.
- **Also applicable: mining** — underground or open-pit haul-truck/AMR
  fleets face the identical problem (shared narrow routes, a central
  dispatcher being a single point of failure a rockfall or comms outage
  can take out) that this project's decentralized design is built to
  survive.

Wiring a preset in is one line — `SCENARIO=hospital npm run dev`, or
`POST /api/simulation/reset { "scenario": "port" }` — since every preset is
just `createInitialState()` options (robot count, urgency ratio, task
cadence). See **Next steps** for what a full scenario picker in the
dashboard would take.

---

## Architecture

```
┌─────────────────────┐        ┌──────────────────────────────┐
│  Browser Dashboard   │◄──WS───┤  server.ts (Node process)     │
│  (Next.js / React)   │──POST─►│   ├─ Next.js request handler  │
└─────────────────────┘        │   ├─ WebSocketServer (/ws)    │
                                │   └─ tick loop (every 150ms)  │
                                │        │                      │
                                │        ▼                      │
                                │  lib/simulation/engine.ts     │
                                │   ├─ taskServer.ts  (announces│
                                │   │   work only — kill-able)  │
                                │   ├─ auction.ts     (decentr- │
                                │   │   alized Contract Net)    │
                                │   ├─ robot.ts       (per-robot│
                                │   │   bidding / intent logic) │
                                │   └─ messageBus.ts  (pub/sub, │
                                │       no agent reads another  │
                                │       robot's state directly) │
                                └───────────┬────────────────────┘
                                            │ POST /api/edge-inference
                                            │
                                ┌───────────┴────────────────┐
                                │ edge-ai-bridge/edge_infer.py │
                                │  real onboard detection +    │
                                │  real wall-clock latency     │
                                └───────────────────────────────┘
```

**Task allocation** is a lightweight Contract Net Protocol (`lib/simulation/auction.ts`):
every idle robot independently prices a newly announced task (travel
distance + a battery penalty) and publishes a bid; the lowest bid wins by a
public rule anyone could re-derive from the published bids — there is no
dispatcher exercising judgment. A task can be flagged **urgent** (randomly,
by `state.urgencyRatio`, or explicitly via `POST /api/tasks`); urgent tasks
are sorted to the front of each tick's auction queue (ties broken by
creation order) so they get first pick of the idle robot pool — the bidding
rule itself doesn't change, only the order tasks draw bidders from, so the
"lowest bid wins, no dispatcher" property still holds.

**Collision avoidance** is a space-time reservation rule
(`lib/simulation/engine.ts` → `resolveMovement`): every robot publishes only
its own intended next cell each tick; conflicting requests are resolved by
"whoever has been waiting longest wins," which is provably starvation-free
— in soak testing a robot at a busy chokepoint waited as long as ~180 ticks
(~27s) behind higher-priority traffic, but always eventually won and moved.
A **courtesy-yield** behavior (also in `resolveMovement`) fixes the one real
livelock we found in testing: an *idle* robot parked on a contested cell
now steps aside after 3 ticks of blocking someone, instead of sitting there
forever (see "A bug we actually hit" below).

**Congestion heat** (`state.heat`, a `nodeId -> number` map on
`SimulationState`) is a lightweight, purely additive metrics signal layered
on top of collision resolution: every blocked move and every tick an idle
robot sits on a contended cell bumps that node's heat, which decays by 5%
every tick. Nothing in pathfinding or the auction ever reads it back — it
can't change simulation outcomes — but it's exactly the "chokepoint
utilization" signal a real ops dashboard would want, and it's already on
the WS/HTTP state payload (`heat`) for a heatmap overlay to consume.
Alongside it, `state.throughput` buckets completed tasks into fixed
20-tick windows (`metrics.throughput`, `metrics.currentRate` for the
latest bucket) so a "tasks/min" trend line doesn't have to be derived
client-side.

**Task-server death and robot death are both survivable**, and behave
differently on purpose:
- Kill the **task server** → no *new* tasks are announced, but every robot
  keeps bidding on already-open tasks, keeps moving, and keeps avoiding
  collisions. Nothing about movement or coordination depends on it.
- Kill a **robot** → it stops physically (a real obstacle other robots must
  route around, not despawn) and, if it was mid-task, that task is
  re-announced and re-auctioned to the rest of the fleet within one tick.

---

## Requirement-by-requirement (against the original PRD)

| PRD item | Status | Where / note |
|---|---|---|
| FR1 — N independent robot agents, own state | ✅ | `lib/types.ts` `Robot`, spawned in `warehouse.ts`; N is configurable 1-16 via `createInitialState({ robotCount })` (default 8, up to 16 via a scenario preset — see **Real-World Applications**) |
| FR2 — real messaging, not shared memory | ✅ | Two transports ship side by side — see **Two transports, one algorithm** below. The default in-process build still uses `messageBus.ts`'s pub/sub discipline; `npm run demo:distributed` runs the literal version, N separate OS processes over real UDP sockets |
| FR3 — local collision avoidance, no central arbiter | ✅ | `engine.ts` `resolveMovement` — a public rule, not a decision-maker |
| FR4 — task auction, exactly one winner | ✅ | `auction.ts` |
| FR5 — real onboard inference model + logged latency | ✅ | `edge-ai-bridge/edge_infer.py` (HOG detector by default, real ONNX-model-swappable) |
| FR6 — live dashboard: positions, tasks, message log | ✅ | `WarehouseCanvas`, `TaskPanel`, `EventLog` |
| FR7 — kill task server, fleet keeps functioning | ✅ | tested — see below |
| FR8 — kill one robot, others don't crash | ✅ | tested — see below |
| FR9 — on-screen counters | ✅ | `MetricsStrip`; underlying metrics now also include throughput history and open-urgent-task count (`metrics.throughput`, `metrics.currentRate`, `metrics.urgentOpen`) |
| Must-have #7 — "kill switch" demo | ✅ | Kill Task Server button + per-robot Kill button |
| Nice-to-have: real physical robot | ❌ not attempted | out of scope for a software-edition Round 1 |
| Nice-to-have: packet-loss injection + graph | ❌ not built | reasonable Round 2 addition, see **Next steps** |
| Nice-to-have: natural-language task intake | ✅ | See **Natural-language task intake** below |

## Two transports, one algorithm (FR2)

The PRD's FR2 asks for *real inter-process messaging* — separate OS
processes talking over real sockets — as proof that decentralization isn't
faked with an in-memory list of robot objects one process quietly controls.

This codebase now ships **both** transports, deliberately, rather than
picking one:

- **In-process (`npm run dev`)** — all robots run inside one Node.js
  process, for the low-friction, always-on dashboard demo. No robot's code
  ever reads another robot's fields directly; every interaction — a bid, a
  movement intent, a yield — goes through `lib/simulation/messageBus.ts`'s
  publish/subscribe interface, the same discipline real sockets would
  force.
- **Real multi-process (`npm run demo:distributed`)** — the literal
  version. One coordinator process plus N separate OS processes
  (`agents/robotAgent.ts`), one per robot, reachable **only** over real UDP
  datagrams on localhost — `ps aux | grep robotAgent` shows the separate
  PIDs while it runs. See **Real distributed transport** below.

Both transports call the **exact same decision functions** — `bidCost()`
and `planPath()` (`lib/simulation/robot.ts`), `pickWinningBid()`
(`lib/simulation/auction.ts`), `resolveMovementConflicts()`
(`lib/simulation/conflicts.ts`) — extracted as pure functions of
`(warehouse, ...)` with no dependency on `SimulationState` or
`MessageBus`. That's what makes "the algorithm is identical across
transports" a checkable claim rather than an assertion: the in-process
engine (`engine.ts`) and the UDP coordinator (`lib/transport/coordinator.ts`)
are two different *drivers* around the same four functions, not two
different implementations that could quietly drift apart.

**If a judge pushes on this**: run `npm run demo:distributed` live, show
`ps aux | grep robotAgent` returning six-plus real PIDs, then point at
`bidCost()` in `lib/simulation/robot.ts` and note that `engine.ts` and
`agents/robotAgent.ts` both import that same function, unmodified.

## Real distributed transport

```
npm run demo:distributed
npm run demo:distributed -- --robots 6 --ticks 40 --scenario hospital
npm run demo:distributed -- --ticks 80 --kill-robot r3 --kill-at-tick 20 --revive-robot r3 --revive-at-tick 50
```

What actually happens: the coordinator process binds a UDP socket and
spawns one child OS process per robot (`agents/robotAgent.ts`). Each agent
process owns nothing but its own UDP socket and (after a one-time
`welcome` handoff) a copy of the static warehouse graph — never
`lib/state/store.ts`, never a direct import of the coordinator. Every tick
the coordinator broadcasts a `tick` snapshot (that robot's own
position/battery/status plus the list of currently-open tasks — never
another robot's private state) to every registered agent; each agent
computes its own bid(s) and next-hop move intent independently and replies
over UDP; the coordinator collects whatever arrives in a short response
window, then runs the same `pickWinningBid()` / `resolveMovementConflicts()`
functions the in-process engine uses. Wire format is one JSON object per
UDP datagram — see `lib/transport/protocol.ts`.

**What's genuinely decentralized vs. what's deliberately still central,
stated plainly rather than oversold:** bid and move-intent *computation*
happens in a separate OS process per robot, is reachable only by UDP, and
literally cannot see another robot's internals — that's the real,
checkable claim FR2 is testing for. Ground-truth position, battery, and
charge/dispatch *timing* stay centralized in the coordinator, by design —
the same way a real deployment would have one motion-capture system or
warehouse-management system as ground truth rather than trusting each
robot's own odometry as the fleet's shared reality. That split is not a
shortcut hiding a fake decentralization; it's the same split any real
fleet architecture makes between "which robot gets the job" (decentralized
here) and "where is everyone, actually" (a services concern, not a
per-robot decision).

**Liveness / the kill-switch demo, done literally:**
`--kill-robot r3 --kill-at-tick 20` sends a real `SIGKILL` to robot r3's
actual OS process — not an API call, not a flag flip, the process stops
existing — at tick 20. UDP delivers no "goodbye" on process death, so the
coordinator has no direct way to know; it notices the same way a real
fleet manager would notice a machine going dark: silence. Each agent sends
a `heartbeat` message every tick it has nothing else to report (so "idle
but alive" is never mistaken for dead), and the coordinator marks a robot
dead once it's gone quiet for `max(2000ms, tickMs × 8)`, orphaning its
held task for re-auction. `--revive-robot r3 --revive-at-tick 50` spawns a
brand-new OS process for that robot id — the same as wheeling a repaired
unit back onto the floor — which re-registers on its old UDP port and
rejoins the auction.

One real bug worth knowing about, since it's a natural thing to hit again
while extending this: spawning the agent processes via `npx tsx ...`, and
even via the locally-installed `tsx` binary directly, interposes a wrapper
process that forks a *second*, inner Node process to actually run the
loader-hooked file — `ps -ef` after a `kill -9` on the outer PID showed the
real agent process reparented to init and still very much alive, still
bound to its UDP port, still bidding. `scripts/distributed-demo.ts` now
spawns `node` directly with tsx's own `--require`/`--import` loader flags
(discoverable by inspecting the live process tree of a normal `tsx`
invocation), so the PID `spawn()` returns is the actual agent process —
one PID, no wrapper layer for a signal to get lost in. Verified by
`ps -ef` showing zero `robotAgent` processes surviving a kill or a
shutdown.

`--log-file` (default `distributed-demo.log.jsonl`, repo root) writes one
JSON line per tick — `datagramsSent`/`datagramsReceived`,
`bidsThisTick`/`intentsThisTick`, `tasksCompleted`, `collisionsAvoided`,
`activeRobots` — so the real UDP traffic can be verified after the fact
without a packet sniffer.

## Natural-language task intake

Type a task in plain English into the command bar above the dashboard
(`components/dashboard/NaturalLanguageBar.tsx`) — "rush a pallet from Dock
A to Charge Bay 2", "move something from zone 5 to the dock" — and it gets
parsed into a real task and dropped into the same auction every
programmatically-created task goes through.

Two parsers, same honesty convention `edge_infer.py` already uses for its
HOG-vs-ONNX split (`lib/llm/taskParser.ts`):

- **Real LLM parse** — if `ANTHROPIC_API_KEY` is set (see `.env.example`),
  the request text plus the warehouse's actual named-location gazetteer
  (`namedLocations()` in `lib/simulation/warehouse.ts` — every dock,
  charge bay, and zone has a human-readable `label` now, not just a node
  id) go to a real Claude API call, which returns strict JSON
  (`{pickupLabel, dropoffLabel, urgent}`).
- **Deterministic rule-based fallback** — if no key is set, a
  substring/preposition matcher (`parseWithRules()`) does the same job
  with no network call.

Critically, **neither path is trusted blindly**: every resolved label,
from the LLM or the rule matcher, is validated against the real warehouse
node graph (`resolveLabel()`) before a task is created — an LLM can't
hallucinate a "Dock Z" that doesn't exist into a real dispatch. The
dashboard shows which path actually ran (`Badge`: `"LLM · <model>"` vs.
`"rule-based parser"`) so a demo never silently claims an LLM call that
didn't happen.

This intentionally does **not** put `ANTHROPIC_API_KEY` in the committed
`.env` — it's your own key to add locally (`.env.example` documents the
variable name plus the optional `ANTHROPIC_MODEL` override, default
`claude-3-5-haiku-latest`); the feature works correctly either way.

## A bug we actually hit (worth knowing before a judge finds it)

Early soak testing surfaced a real livelock: the collision rule only ranked
robots that were *both trying to move*, so an idle robot sitting on a
contested cell blocked it forever — nobody outranked a robot that wasn't
even in the race. Fixed by giving idle robots a courtesy-yield: after 3
ticks of blocking someone, they step to a free neighboring cell and go back
to idle. This is a legitimate example of exactly the "deadlock/livelock"
failure mode PRD §3 asks whether your team understands — it's worth
mentioning proactively in the pitch rather than hoping nobody asks.

---

## Running the edge-AI bridge for real

```
cd edge-ai-bridge
pip install -r requirements.txt
python make_sample_frames.py
python edge_infer.py --server http://localhost:3000 --robot-id r1
```

- Default detector is OpenCV's built-in HOG person detector — real,
  on-device, zero downloads. Expect ~10–20ms per pass on a laptop CPU;
  numbers will differ (usually higher, which is fine and expected) on a Pi
  or Jetson.
- `--source webcam` uses a live camera instead of the bundled synthetic
  frames.
- `--model path/to/model.onnx` swaps in a real quantized detector if your
  team trains/exports one (`pip install onnxruntime` first) — the
  postprocessing in `OnnxDetector.infer` is a generic stub; adjust it to
  your model's actual output layout before trusting detection counts (the
  latency number is trustworthy regardless).
- Every reading appears in the dashboard's event log (purple lines) and
  rolls into the **Avg Inference** tile — which only updates while the
  simulation is running (it's recomputed once per tick).

---

## Demo script (~4–5 min)

1. **Frame the gap** — most "distributed" fleet demos have a hidden single
   controller. Say what's different here in one sentence.
2. **Start the sim** — robots bid, move, avoid each other. Point at the
   message log: every bid and yield is a real logged event, not animation.
3. **Zoom into a chokepoint** — pause at a moment two robots meet at an
   intersection; narrate the reservation rule resolving it.
4. **The kill-switch moment** — hit **Kill Task Server**. Fleet keeps
   moving and finishing open tasks. Then **Kill** one moving robot — its
   task gets re-announced and re-won by someone else within a tick, and
   the rest of the fleet visibly routes around its now-dead body.
5. **Edge-AI panel** — show `edge_infer.py` running in a terminal, real
   latency numbers landing live in the dashboard.
6. **Close** — mention the two transports already exist side by side
   (`npm run demo:distributed` for the literal multi-process version), and
   what's still left for Round 2: a trained detection model, packet-loss
   injection, physical hardware.

---

## Next steps (Round 2, if selected)

- ~~Swap `messageBus.ts` for real UDP or ROS2 DDS transport across N actual
  processes~~ — **done**, see **Real distributed transport** above
  (`lib/transport/`, `agents/robotAgent.ts`, `npm run demo:distributed`).
  A real ROS2 DDS transport instead of hand-rolled UDP JSON remains a
  reasonable further step if the team wants closer parity with actual
  robot middleware.
- ~~Natural-language task intake~~ — **done**, see
  **Natural-language task intake** above (`lib/llm/taskParser.ts`).
- Train/export a small quantized YOLOv8n or MobileNet-SSD ONNX model for
  `edge_infer.py --model`, replacing the classical HOG baseline.
- Add simulated packet loss / latency injection to the real UDP transport
  with a live degradation graph (PRD nice-to-have) — dropping/delaying
  datagrams in `lib/transport/coordinator.ts`'s socket handler is a small
  addition now that the transport is real, not simulated.
- Put the agent loop on a real Raspberry Pi or Jetson Nano chassis — one
  `agents/robotAgent.ts` process per physical unit, pointed at a
  coordinator over the LAN instead of localhost, is most of the way there
  already.
- Wire `lib/simulation/scenarios.ts`'s presets into an actual dashboard
  picker (currently reachable via `SCENARIO=<key> npm run dev` or
  `POST /api/simulation/reset { "scenario": "<key>" }`, but not yet a UI
  control) and render `state.heat` as a live warehouse-floor overlay.

---

## Project layout

See `docs/EdgeFleet_Final_PRD.md` for the original planning document this
was built against. Directory structure follows the PRD's sketch closely;
notable additions beyond it: `lib/simulation/metrics.ts`,
`lib/simulation/scenarios.ts` (named deployment presets — fleet size,
urgency ratio, task cadence — see **Real-World Applications**),
`app/api/simulation/revive-robot/[id]/route.ts` and
`app/api/simulation/revive-task-server/route.ts` (so a demo rehearsal can
reset without restarting the server), `lib/transport/` +
`agents/robotAgent.ts` + `scripts/distributed-demo.ts` (the real
multi-process UDP transport — see **Real distributed transport**),
`lib/llm/taskParser.ts` + `app/api/tasks/natural-language/route.ts` +
`components/dashboard/NaturalLanguageBar.tsx` (natural-language task
intake — see **Natural-language task intake**), and this README.

## Troubleshooting

- **Port already in use** — set `PORT=3001` (or any free port) in `.env`.
- **Dashboard shows tick 0 forever** — make sure you're running `npm run dev`
  / `npm start` (the custom server), not `next dev` directly; only the
  custom server runs the tick loop and the WebSocket endpoint.
- **`/api/state` looks frozen** — this bit us in testing: Next.js will
  silently static-prerender a GET route with no dynamic inputs at build
  time. Both `app/api/state/route.ts` and `app/api/tasks/route.ts` already
  set `export const dynamic = "force-dynamic"` — keep that if you add more
  GET routes that read live state.
