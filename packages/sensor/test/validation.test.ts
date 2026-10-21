import { describe, expect, it } from "vitest";
import { isMainEnvelope, isSensorBatch, isSensorEvent } from "@webos/shared";
import type { SensorEvent } from "@webos/shared";

const delta: SensorEvent = {
  type: "sensor.text.delta",
  requestId: "r1",
  channel: "answer",
  text: "hello",
};

describe("runtime validation", () => {
  it("accepts a valid event and batch", () => {
    expect(isSensorEvent(delta)).toBe(true);
    expect(isSensorBatch({ v: 1, pageSessionId: "p1", seq: 1, events: [delta] })).toBe(true);
  });

  it("rejects forged or malformed events", () => {
    expect(isSensorEvent({ type: "sensor.text.delta", requestId: "r1", channel: "answer", text: 42 })).toBe(false);
    expect(isSensorEvent({ type: "evil" })).toBe(false);
    expect(isSensorBatch({ v: 1, pageSessionId: "p1", seq: 1, events: [{ type: "evil" }] })).toBe(false);
    expect(isSensorBatch({ v: 2, pageSessionId: "p1", seq: 1, events: [] })).toBe(false);
  });

  it("validates the main-world envelope", () => {
    expect(
      isMainEnvelope({
        source: "webos.sensor.main",
        v: 1,
        nonce: "n1",
        message: { kind: "webos/sensor.ready", v: 1, pageSessionId: "p1" },
      }),
    ).toBe(true);
    expect(isMainEnvelope({ source: "evil", v: 1, nonce: "n1", message: {} })).toBe(false);
  });
});
