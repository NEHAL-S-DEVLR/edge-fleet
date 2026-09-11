# PRD — Edge-AI Distributed Fleet Coordination for AMRs
### Internal Hackathon Prototype (Round 1)
**Problem statement:** SIH26123 — Bharat Electronics Limited — Robotics and Drones
**Stage:** College-internal hackathon, first level (selection round for SIH software edition)
**Status:** Implemented v1 (this repository)

> This is the original planning PRD this codebase was built against, kept
> verbatim for reference. See README.md for what was actually shipped, how
> it maps to each requirement below, and the honest deltas from this plan.

---

## 1. Assumptions
- Build window: ~24–36 hours (adjust timeline in §11 if different)
- Team size: 4–6 people
- No guaranteed access to physical robots — prototype is simulation-first
- Goal of this round is *not* to solve the full problem statement. It's to prove the two ideas that make this PS hard — real decentralization and real edge inference — actually work.

## 2. Problem, restated
Multiple AMRs in a warehouse need to plan paths, avoid collisions, and pick up tasks *without* depending on a single central controller, using AI inference that runs on the robot itself, not the cloud. Most naive solutions fake this — a "distributed" system that quietly has one server making all the decisions.

## 3. What judges are actually scoring
- Is the coordination genuinely peer-to-peer, or is there a hidden single point of failure?
- Is there real AI running on constrained compute, with real latency numbers — not just a slide claiming "edge AI"?
- Does the team understand the failure modes (deadlock, livelock, network partition), not just the happy path?
- Is the demo provable, not just visual?

## 4. Scope

### 4.1 Must-have
1. Multi-agent simulator, 6–10 robots on a warehouse grid
2. Real inter-process messaging (proves decentralization)
3. Local collision avoidance (velocity-obstacle / ORCA-style reactive layer)
4. Peer task auction (lightweight Contract Net)
5. One real quantized model doing onboard inference with logged latency
6. Live dashboard: robot positions, task queue, message log
7. "Kill switch" demo — terminate the task server and/or one robot mid-run, fleet keeps functioning

### 4.2 Nice-to-have
- A physical robot (or wheeled RC chassis + Pi) running the same agent code
- Battery-aware or deadline-aware priority weighting in the auction
- 3D visualization instead of 2D top-down view
- Simulated packet loss / latency injection with a graph of degradation

### 4.3 Explicitly out of scope
- Integration with a real WMS/ERP
- Production security/auth on the comms layer
- Multi-floor or multi-warehouse coordination
- SLAM-based mapping (use a static pre-built warehouse layout instead)

## 5. System architecture
- **Task server** — assigns tasks at startup and periodically. Not involved in real-time movement or collision avoidance. Can be killed after boot without halting the fleet.
- **Peer mesh** — robots broadcast position + intended path to nearby peers directly. No broker in the loop.
- **Per-robot agent** — Perception (onboard model), Local planner (reactive collision avoidance), Coordination logic (auction bidding + intent broadcasting).

## 6–13. Functional/non-functional requirements, stack, timeline, roles, risks, demo script, on-screen metrics
See README.md §"Requirement-by-requirement" for how each item in the original PRD maps to actual code in this repository, including the honest simplifications made for a single-process build.
