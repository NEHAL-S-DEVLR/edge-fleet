"use client";

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export function TopBar({
  running,
  connected,
  tick,
  taskServerAlive,
  onStart,
  onPause,
  onReset,
  onKillTaskServer,
  onReviveTaskServer,
  onAddTask,
  onHowItWorks,
}: {
  running: boolean;
  connected: boolean;
  tick: number;
  taskServerAlive: boolean;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onKillTaskServer: () => void;
  onReviveTaskServer: () => void;
  onAddTask: () => void;
  onHowItWorks: () => void;
}) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 bg-surface">
      <div className="flex items-center gap-2 mr-2">
        <span className={`w-2 h-2 rounded-full ${connected ? "bg-good" : "bg-bad"} pulse`} />
        <h1 className="font-display text-xl uppercase tracking-wide leading-none">EdgeFleet</h1>
      </div>
      <Badge tone={running ? "good" : "neutral"}>{running ? "Running" : "Paused"}</Badge>
      <span className="font-mono text-xs text-[#8b8677]">tick {tick}</span>
      <div className="flex-1" />
      <Button variant="quiet" onClick={onAddTask}>
        + Inject Task
      </Button>
      <Button variant={taskServerAlive ? "danger" : "primary"} onClick={taskServerAlive ? onKillTaskServer : onReviveTaskServer}>
        {taskServerAlive ? "Kill Task Server" : "Revive Task Server"}
      </Button>
      <Button variant="ghost" onClick={onReset}>
        Reset
      </Button>
      {running ? (
        <Button variant="ghost" onClick={onPause}>
          Pause
        </Button>
      ) : (
        <Button variant="primary" onClick={onStart}>
          Start
        </Button>
      )}
      <Button variant="quiet" onClick={onHowItWorks}>
        How It Works
      </Button>
    </header>
  );
}
