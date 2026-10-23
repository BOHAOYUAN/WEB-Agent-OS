/**
 * Minimal WebSocket test client for the Actor bridge.
 *
 * The bridge speaks RFC 6455 on a raw socket, and the server-side decoder
 * REFUSES unmasked client frames (spec §5.1). So the client here masks its
 * frames and parses the server's unmasked ones by hand — no dependency, no
 * `ws` package, and the same hand-rolled protocol the production code uses.
 *
 * Test-only helper: it lives in `test/` but is not a `.test.ts` file, so
 * vitest does not try to run it as a suite.
 */

import { connect, type Socket } from "node:net";

export interface TestClient {
  /** Send a text frame (the bridge only speaks text). */
  send(text: string): void;
  /** Wait for the next server message (text frame payload). */
  next(timeoutMs?: number): Promise<string>;
  /** Close the socket. */
  close(): void;
}

/** Encode one masked client→server text frame. */
export function encodeClientFrame(text: string): Buffer {
  const data = Buffer.from(text, "utf8");
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const header: number[] = [0x81];
  if (data.length < 126) {
    header.push(0x80 | data.length);
  } else if (data.length < 65536) {
    header.push(0x80 | 126, data.length >> 8, data.length & 0xff);
  } else {
    throw new Error("test client payload too large");
  }
  const masked = Buffer.from(data);
  for (let i = 0; i < masked.length; i++) {
    masked[i] = masked[i]! ^ mask[i % 4]!;
  }
  return Buffer.concat([Buffer.from(header), mask, masked]);
}

/** Pull complete text frames out of a server→client buffer. */
export function decodeServerFrames(buffer: Buffer): { messages: string[]; rest: Buffer } {
  const messages: string[] = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset]!;
    const second = buffer[offset + 1]!;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (buffer.length - cursor < 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      throw new Error("unexpected 64-bit frame length in test client");
    }
    const maskLength = masked ? 4 : 0;
    if (buffer.length - cursor - maskLength < length) break;
    const payload = buffer.subarray(cursor + maskLength, cursor + maskLength + length);
    if (opcode === 0x1) messages.push(payload.toString("utf8"));
    offset = cursor + maskLength + length;
  }
  return { messages, rest: buffer.subarray(offset) };
}

/**
 * Connect to the bridge and complete the WebSocket handshake.
 *
 * Rejects when the server refuses the upgrade — that is how the tests observe
 * a 401/403 without speaking WebSocket at all.
 */
export async function connectClient(port: number, token: string): Promise<TestClient> {
  const socket: Socket = connect(port, "127.0.0.1");
  const queued: string[] = [];
  const waiters: Array<(message: string) => void> = [];
  // Widened explicitly: `Buffer.alloc` returns Buffer<ArrayBuffer>, but the
  // socket hands back Buffer<ArrayBufferLike> chunks.
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let handshakeDone = false;
  let resolveHandshake: () => void = () => undefined;
  let rejectHandshake: (error: Error) => void = () => undefined;

  const handshake = new Promise<void>((resolve, reject) => {
    resolveHandshake = resolve;
    rejectHandshake = reject;
  });

  socket.on("error", (error) => {
    if (!handshakeDone) rejectHandshake(error);
  });

  socket.on("data", (chunk: Buffer) => {
    if (!handshakeDone) {
      const text = chunk.toString("latin1");
      const separator = text.indexOf("\r\n\r\n");
      if (separator === -1) return;
      if (!text.startsWith("HTTP/1.1 101")) {
        rejectHandshake(new Error(`handshake refused: ${text.split("\r\n")[0] ?? "?"}`));
        socket.destroy();
        return;
      }
      handshakeDone = true;
      buffer = chunk.subarray(separator + 4);
      resolveHandshake();
    } else {
      buffer = Buffer.concat([buffer, chunk]);
    }
    const { messages, rest } = decodeServerFrames(buffer);
    buffer = rest;
    for (const message of messages) {
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else queued.push(message);
    }
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("handshake timeout")), 3000);
    socket.once("connect", () => {
      socket.write(
        "GET /?token=" +
          encodeURIComponent(token) +
          " HTTP/1.1\r\n" +
          "Host: 127.0.0.1\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n\r\n",
      );
    });
    handshake.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: Error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

  return {
    send(text: string): void {
      socket.write(encodeClientFrame(text));
    },
    next(timeoutMs = 3000): Promise<string> {
      const ready = queued.shift();
      if (ready !== undefined) return Promise.resolve(ready);
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for a message")), timeoutMs);
        waiters.push((message) => {
          clearTimeout(timer);
          resolve(message);
        });
      });
    },
    close(): void {
      socket.destroy();
    },
  };
}
