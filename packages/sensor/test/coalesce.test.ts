import { describe, expect, it } from "vitest";
import { coalesceEvents } from "@webos/shared";
import type { SensorEvent } from "@webos/shared";

const delta = (channel: "thinking" | "answer", text: string): SensorEvent => ({
  type: "sensor.text.delta",
  requestId: "r1",
  channel,
  text,
});

describe("coalesceEvents", () => {
  it("merges adjacent deltas of the same channel", () => {
    const events = [delta("answer", "a"), delta("answer", "b"), delta("answer", "c")];
    expect(coalesceEvents(events)).toEqual([delta("answer", "abc")]);
  });

  it("does not merge across channels, requests or control events", () => {
    const start: SensorEvent = {
      type: "sensor.stream.start",
      requestId: "r1",
      ts: 1,
      transport: "xhr",
      endpoint: "/api/v0/chat/completion",
      thinkingEnabled: false,
    };
    const events = [delta("thinking", "a"), delta("answer", "b"), start, delta("answer", "c")];
    expect(coalesceEvents(events)).toEqual(events);
  });

  it("respects the max chunk size", () => {
    const merged = coalesceEvents([delta("answer", "aaaa"), delta("answer", "bbbb")], 5);
    expect(merged).toHaveLength(2);
  });
});
