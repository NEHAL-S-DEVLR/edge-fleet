"use client";

import { useState } from "react";
import { useSimulationSocket } from "@/hooks/useSimulationSocket";
import { TopBar } from "@/components/dashboard/TopBar";
import { NaturalLanguageBar } from "@/components/dashboard/NaturalLanguageBar";
import { FleetPanel } from "@/components/dashboard/FleetPanel";
import { WarehouseCanvas } from "@/components/dashboard/WarehouseCanvas";
import { TaskPanel } from "@/components/dashboard/TaskPanel";
import { EventLog } from "@/components/dashboard/EventLog";
import { MetricsStrip } from "@/components/dashboard/MetricsStrip";
import { HowItWorksModal } from "@/components/dashboard/HowItWorksModal";
import { SCENARIOS } from "@/lib/simulation/scenarios";

export default function Page() {
  const sim = useSimulationSocket();
  const [howItWorks, setHowItWorks] = useState(false);

  if (!sim.state) {
    return (
      <div className="h-screen flex items-center justify-center bg-graphite text-[#8b8677] font-mono text-sm">
        Connecting to fleet server…
      </div>
    );
  }

  const { state } = sim;

  return (
    <div className="h-screen flex flex-col bg-graphite text-[#ecebe6]">
      <TopBar
        running={state.running}
        connected={sim.connected}
        tick={state.tick}
        taskServerAlive={state.taskServerAlive}
        scenarioKey={state.scenarioKey}
        onStart={sim.start}
        onPause={sim.pause}
        onReset={sim.reset}
        onKillTaskServer={sim.killTaskServer}
        onReviveTaskServer={sim.reviveTaskServer}
        onAddTask={sim.addTask}
        onHowItWorks={() => setHowItWorks(true)}
      />

      <NaturalLanguageBar onSubmit={sim.addNaturalLanguageTask} />

      <div className="flex-1 grid grid-cols-[240px_1fr_320px] min-h-0">
        <div className="border-r border-line min-h-0">
          <FleetPanel
            robots={state.robots}
            robotLabel={state.scenarioKey ? SCENARIOS[state.scenarioKey]?.robotLabel : undefined}
            onKill={sim.killRobot}
            onRevive={sim.reviveRobot}
          />
        </div>

        <div className="min-h-0">
          <WarehouseCanvas warehouse={state.warehouse} robots={state.robots} tasks={state.tasks} heat={state.heat} />
        </div>

        <div className="border-l border-line min-h-0 grid grid-rows-2">
          <div className="border-b border-line min-h-0">
            <TaskPanel tasks={state.tasks} />
          </div>
          <div className="min-h-0">
            <EventLog messages={state.messages} />
          </div>
        </div>
      </div>

      <MetricsStrip metrics={state.metrics} />
      <HowItWorksModal open={howItWorks} onClose={() => setHowItWorks(false)} />
    </div>
  );
}
