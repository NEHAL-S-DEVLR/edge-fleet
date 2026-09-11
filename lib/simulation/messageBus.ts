// A minimal synchronous pub/sub bus used *inside* a single tick.
//
// This is what stands in for "robots talk over sockets, not shared memory"
// in the single-process simulation: robot logic never reads another
// robot's fields directly. It publishes its intended move / bid onto the
// bus, and the tick engine (playing the role of the wireless medium)
// collects everything that was published this tick before anyone reacts
// to it. Swap this file for real UDP/MQTT/ROS2 DDS transport and nothing
// above lib/simulation/ has to change — see docs/EdgeFleet_Final_PRD.md.
export type BusTopic = "intent" | "bid" | "yield";

export interface IntentMsg {
  robotId: string;
  fromNode: number;
  toNode: number;
}
export interface BidMsg {
  robotId: string;
  taskId: string;
  cost: number;
}
export interface YieldMsg {
  robotId: string;
  atNode: number;
  reason: string;
}

type Payloads = { intent: IntentMsg; bid: BidMsg; yield: YieldMsg };

export class MessageBus {
  private buffers: { [K in BusTopic]: Payloads[K][] } = {
    intent: [],
    bid: [],
    yield: [],
  };

  publish<T extends BusTopic>(topic: T, msg: Payloads[T]) {
    this.buffers[topic].push(msg);
  }

  drain<T extends BusTopic>(topic: T): Payloads[T][] {
    const msgs = this.buffers[topic];
    this.buffers[topic] = [];
    return msgs;
  }

  peek<T extends BusTopic>(topic: T): Payloads[T][] {
    return this.buffers[topic];
  }
}
