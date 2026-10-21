import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SseDecoder } from "@webos/shared";

function fixture(name: string): string {
  return readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");
}

function decodeAll(raw: string, chunkSize: number, maxBufferChars = 1_000_000): string[] {
  const decoder = new SseDecoder({ maxBufferChars });
  const out: string[] = [];
  for (let index = 0; index < raw.length; index += chunkSize) {
    for (const event of decoder.push(raw.slice(index, index + chunkSize))) out.push(event.data);
  }
  for (const event of decoder.end()) out.push(event.data);
  return out;
}

describe("SseDecoder", () => {
  it("parses standard data frames", () => {
    const data = decodeAll(fixture("basic-answer.sse.txt"), 9999);
    expect(data).toHaveLength(4);
    expect(data[0]).toContain('"fragments"');
    expect(data[3]).toContain("FINISHED");
  });

  it("is invariant under arbitrary chunk boundaries", () => {
    const raw = fixture("basic-answer.sse.txt");
    const expected = decodeAll(raw, raw.length);
    for (let size = 1; size <= 64; size += 1) {
      expect(decodeAll(raw, size)).toEqual(expected);
    }
  });

  it("handles CRLF, comments and multi-line data", () => {
    const raw =
      ": keep-alive\r\n\r\n" +
      "data: line-one\r\n" +
      "data: line-two\r\n\r\n" +
      "data: [DONE]\r\n\r\n";
    const events = decodeAll(raw, 3);
    expect(events).toEqual(["line-one\nline-two", "[DONE]"]);
  });

  it("falls back to line-delimited JSON", () => {
    const raw = fixture("ndjson.sse.txt");
    const events = decodeAll(raw, 5);
    expect(events).toHaveLength(3);
    expect(events[0]).toBe('{"v":"a"}');
  });

  it("flushes a truncated tail without throwing", () => {
    const raw = 'data: {"v":"unfinished"}';
    expect(decodeAll(raw, 4)).toEqual(['{"v":"unfinished"}']);
  });

  it("flags buffer overflow instead of growing without bound", () => {
    const decoder = new SseDecoder({ maxBufferChars: 20 });
    const events = decoder.push("x".repeat(21));
    expect(events).toEqual([]);
    expect(decoder.overflowed).toBe(true);
    expect(decoder.push("more")).toEqual([]);
  });
});
