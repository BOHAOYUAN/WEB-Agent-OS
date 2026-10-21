import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DeepSeekNormalizer, SseDecoder } from "@webos/shared";
import type { SensorEvent } from "@webos/shared";

function fixture(name: string): string {
  return readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");
}

function run(raw: string, thinkingEnabled = false): SensorEvent[] {
  const events: SensorEvent[] = [];
  const normalizer = new DeepSeekNormalizer({
    requestId: "req-1",
    thinkingEnabled,
    emit: (event) => events.push(event),
    now: () => 123,
  });
  const decoder = new SseDecoder();
  for (const event of decoder.push(raw)) normalizer.pushData(event.data);
  for (const event of decoder.end()) normalizer.pushData(event.data);
  normalizer.end("transport-closed");
  return events;
}

function text(events: SensorEvent[], channel: "thinking" | "answer"): string {
  return events
    .filter((event): event is Extract<SensorEvent, { type: "sensor.text.delta" }> => event.type === "sensor.text.delta")
    .filter((event) => event.channel === channel)
    .map((event) => event.text)
    .join("");
}

function endReason(events: SensorEvent[]): string | undefined {
  const end = events.find((event) => event.type === "sensor.stream.end");
  return end?.type === "sensor.stream.end" ? end.reason : undefined;
}

function shape(events: SensorEvent[]): unknown[] {
  return events.map((event) => {
    if (event.type === "sensor.text.delta") return [event.type, event.channel, event.text];
    if (event.type === "sensor.stream.end") return [event.type, event.reason];
    if (event.type === "sensor.error") return [event.type, event.code, event.fatal];
    return [event.type];
  });
}

describe("DeepSeekNormalizer", () => {
  it("emits answer deltas and finishes", () => {
    const events = run(fixture("basic-answer.sse.txt"));
    expect(text(events, "answer")).toBe("你好，世界！");
    expect(endReason(events)).toBe("finished");
  });

  it("separates thinking and answer channels", () => {
    const events = run(fixture("thinking.sse.txt"), true);
    expect(text(events, "thinking")).toBe("先想");
    expect(text(events, "answer")).toBe("答案是42");
    expect(endReason(events)).toBe("finished");
  });

  it("does not duplicate text when a snapshot is replayed", () => {
    const events = run(fixture("snapshot-replay.sse.txt"));
    expect(text(events, "answer")).toBe("ABC");
  });

  it("buffers orphan deltas until a thinking fragment identifies them", () => {
    const events = run(fixture("orphan-thinking.sse.txt"), true);
    expect(text(events, "thinking")).toBe("先想一下");
    expect(text(events, "answer")).toBe("");
  });

  it("finishes a truncated transport with the transport reason", () => {
    const events = run(fixture("truncated.sse.txt"));
    expect(text(events, "answer")).toBe("半截");
    expect(endReason(events)).toBe("transport-closed");
  });

  it("reports business errors as fatal", () => {
    const events = run(fixture("business-error.sse.txt"));
    const error = events.find((event) => event.type === "sensor.error");
    expect(error?.type).toBe("sensor.error");
    if (error?.type === "sensor.error") {
      expect(error.fatal).toBe(true);
      expect(error.message).toContain("bad request");
    }
    expect(endReason(events)).toBe("error");
  });

  it("is invariant under arbitrary chunk boundaries", () => {
    const raw = fixture("thinking.sse.txt");
    const expected = shape(run(raw, true));
    for (let size = 1; size <= 24; size += 1) {
      const events: SensorEvent[] = [];
      const normalizer = new DeepSeekNormalizer({
        requestId: "req-1",
        thinkingEnabled: true,
        emit: (event) => events.push(event),
        now: () => 123,
      });
      const decoder = new SseDecoder();
      for (let index = 0; index < raw.length; index += size) {
        for (const event of decoder.push(raw.slice(index, index + size))) normalizer.pushData(event.data);
      }
      for (const event of decoder.end()) normalizer.pushData(event.data);
      normalizer.end("transport-closed");
      expect(shape(events)).toEqual(expected);
    }
  });

  it("treats [DONE] as a normal finish", () => {
    const events = run('data: {"v":"ok"}\n\ndata: [DONE]\n\n');
    expect(text(events, "answer")).toBe("ok");
    expect(endReason(events)).toBe("finished");
  });
});
