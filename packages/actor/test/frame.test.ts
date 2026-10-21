import { describe, expect, it } from "vitest";
import { encodeFrame, FrameDecoder, parseClosePayload } from "../src/transport/frame.js";

describe("encodeFrame", () => {
  it("encodes a small unmasked text frame", () => {
    const frame = encodeFrame(0x1, "hi");
    // FIN + text opcode
    expect(frame[0]).toBe(0x81);
    // unmasked, length 2
    expect(frame[1]).toBe(0x02);
    expect(frame.subarray(2).toString("utf8")).toBe("hi");
  });

  it("encodes a 16-bit length payload", () => {
    const payload = "x".repeat(200);
    const frame = encodeFrame(0x1, payload);
    expect(frame[1]).toBe(126);
    expect(frame.readUInt16BE(2)).toBe(200);
  });

  it("encodes a 64-bit length payload", () => {
    const payload = Buffer.alloc(70000, 0x61);
    const frame = encodeFrame(0x2, payload);
    expect(frame[1]).toBe(127);
    expect(Number(frame.readBigUInt64BE(2))).toBe(70000);
  });
});

describe("FrameDecoder", () => {
  function mask(payload: Buffer): Buffer {
    const mask = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const header = Buffer.from([0x81, 0x80 | payload.length]);
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i += 1) masked[i] = masked[i]! ^ mask[i % 4]!;
    return Buffer.concat([header, mask, masked]);
  }

  it("decodes a complete masked text frame", () => {
    const messages: string[] = [];
    const decoder = new FrameDecoder({
      onMessage: (data, _binary) => messages.push(data.toString("utf8")),
      onClose: () => undefined,
      onPing: () => undefined,
      onPong: () => undefined,
      onError: () => undefined,
    });
    decoder.push(mask(Buffer.from("hello")));
    expect(messages).toEqual(["hello"]);
  });

  it("reassembles a message split across multiple chunks", () => {
    const messages: string[] = [];
    const decoder = new FrameDecoder({
      onMessage: (data) => messages.push(data.toString("utf8")),
      onClose: () => undefined,
      onPing: () => undefined,
      onPong: () => undefined,
      onError: () => undefined,
    });
    const frame = mask(Buffer.from("hello world"));
    decoder.push(frame.subarray(0, 3));
    decoder.push(frame.subarray(3));
    expect(messages).toEqual(["hello world"]);
  });

  it("reassembles fragmented messages", () => {
    const messages: string[] = [];
    const decoder = new FrameDecoder({
      onMessage: (data) => messages.push(data.toString("utf8")),
      onClose: () => undefined,
      onPing: () => undefined,
      onPong: () => undefined,
      onError: () => undefined,
    });

    // Build a masked fragmented message manually:
    //   fragment 1: FIN=0, opcode=text, payload "hello"
    //   fragment 2: FIN=1, opcode=continuation, payload " world"
    const makeFragmented = (fin: boolean, opcode: number, payload: string): Buffer => {
      const maskKey = Buffer.from([0x0a, 0x0b, 0x0c, 0x0d]);
      const body = Buffer.from(payload, "utf8");
      const header = Buffer.from([(fin ? 0x80 : 0x00) | opcode, 0x80 | body.length]);
      const masked = Buffer.from(body);
      for (let i = 0; i < masked.length; i += 1) masked[i] = masked[i]! ^ maskKey[i % 4]!;
      return Buffer.concat([header, maskKey, masked]);
    };

    const frag1 = makeFragmented(false, 0x1, "hello");
    const frag2 = makeFragmented(true, 0x0, " world");

    decoder.push(frag1);
    expect(messages).toEqual([]); // not yet complete
    decoder.push(frag2);
    expect(messages).toEqual(["hello world"]);
  });

  it("emits ping callbacks", () => {
    let pinged = false;
    const decoder = new FrameDecoder({
      onMessage: () => undefined,
      onClose: () => undefined,
      onPing: () => { pinged = true; },
      onPong: () => undefined,
      onError: () => undefined,
    });
    // ping frame (opcode 0x9), FIN, unmasked, length 0
    decoder.push(Buffer.from([0x89, 0x00]));
    expect(pinged).toBe(true);
  });

  it("rejects an unmasked client data frame", () => {
    let error = "";
    const decoder = new FrameDecoder({
      onMessage: () => undefined,
      onClose: () => undefined,
      onPing: () => undefined,
      onPong: () => undefined,
      onError: (msg) => { error = msg; },
    });
    // unmasked text frame (violates RFC 6455 for clients)
    decoder.push(Buffer.from([0x81, 0x02, 0x68, 0x69]));
    expect(error).toContain("masked");
  });
});

describe("parseClosePayload", () => {
  it("parses a code + reason", () => {
    const payload = Buffer.concat([Buffer.from([0x03, 0xe8]), Buffer.from("bye")]);
    expect(parseClosePayload(payload)).toEqual({ code: 1000, reason: "bye" });
  });

  it("returns default for empty payload", () => {
    expect(parseClosePayload(Buffer.alloc(0))).toEqual({ code: 1000, reason: "" });
  });
});
