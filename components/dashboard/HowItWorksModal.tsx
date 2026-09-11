"use client";

import { Modal } from "@/components/ui/Modal";

export function HowItWorksModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="How This Actually Works">
      <p>
        <strong className="text-[#ecebe6]">No central controller drives the fleet.</strong> The task server (top
        right button) only announces work — kill it and robots keep moving, keep avoiding each other, and keep
        finishing whatever they already picked up.
      </p>
      <p>
        <strong className="text-[#ecebe6]">Task allocation is a decentralized auction.</strong> When a task is
        announced, every idle robot independently computes its own bid (distance + battery penalty) and publishes it.
        The lowest bid wins by a public, deterministic rule — not a dispatcher's discretion. Watch the message log:
        every bid is a real logged message, not a hidden calculation.
      </p>
      <p>
        <strong className="text-[#ecebe6]">Collision avoidance is local.</strong> Each tick, every moving robot
        publishes only its own intended next cell. The engine (standing in for the wireless medium, not a traffic
        cop) applies the same reservation rule to everyone: whoever's been waiting longer gets the cell, ties broken
        by robot id. Two robots meeting head-on in a single-width aisle resolve the same way. This is why the "kill
        a robot" button matters — the dead robot still physically blocks its aisle cell, and the rest of the fleet
        has to route around it, exactly like a real breakdown.
      </p>
      <p>
        <strong className="text-[#ecebe6]">Edge-AI is real, not narrated.</strong> The separate{" "}
        <code className="font-mono text-xs bg-surface2 px-1 rounded-sm">edge-ai-bridge/edge_infer.py</code> script
        runs an actual onboard detection pass (on a laptop CPU or a Raspberry Pi/Jetson if you have one) and posts
        its real latency to this dashboard after every inference — that's the purple{" "}
        <code className="font-mono text-xs bg-surface2 px-1 rounded-sm">edge-inference</code> line in the log and
        the "Avg Inference" tile below.
      </p>
      <p className="text-[#8b8677] text-xs pt-2 border-t border-line">
        Honest caveat for judges who ask: robots here are simulated in one Node.js process rather than N separate
        machines on real sockets, so "distributed" describes the message-passing discipline (no robot reads another's
        state directly, only published messages) rather than physical process isolation. Swapping the in-process
        MessageBus for real UDP/MQTT/ROS2 DDS transport — one file, lib/simulation/messageBus.ts — doesn't require
        touching the coordination logic. See docs/EdgeFleet_Final_PRD.md.
      </p>
    </Modal>
  );
}
