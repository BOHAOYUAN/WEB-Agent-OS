import { LIMITS } from "../constants.js";
import type { SensorEvent } from "../types/events.js";

/**
 * Merge adjacent deltas of the same request/channel. This is a pure function so
 * the bridge can batch on a timer and tests can assert exact ordering.
 */
export function coalesceEvents(events: SensorEvent[], maxChars: number = LIMITS.coalesceMaxChars): SensorEvent[] {
  const out: SensorEvent[] = [];
  for (const event of events) {
    const previous = out.at(-1);
    if (
      event.type === "sensor.text.delta" &&
      previous?.type === "sensor.text.delta" &&
      previous.requestId === event.requestId &&
      previous.channel === event.channel &&
      previous.text.length + event.text.length <= maxChars
    ) {
      out[out.length - 1] = { ...previous, text: previous.text + event.text };
      continue;
    }
    out.push(event);
  }
  return out;
}
