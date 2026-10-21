/**
 * RFC 6455 WebSocket frame encode/decode — implemented from scratch, zero deps.
 *
 * This is deliberately hand-rolled (rather than using the `ws` library) because
 * the Actor is the security-sensitive layer of the system: every byte that
 * crosses the local bridge is parsed here, and a hand-written decoder is easier
 * to audit than a third-party dependency's.
 *
 * Supports the subset the bridge actually needs:
 *   - text frames (opcode 0x1) and binary frames (0x2)
 *   - close (0x8), ping (0x9), pong (0xA)
 *   - continuation frames (opcode 0x0) for fragmented messages
 *   - 7-bit, 16-bit, and 64-bit payload lengths
 *   - masked client frames (required by spec) and unmasked server frames
 *
 * A single decoder instance is stateful: it buffers partial frames across
 * socket `data` events and emits complete messages via `onMessage`.
 */

export type FrameOpcode = 0x0 | 0x1 | 0x2 | 0x8 | 0x9 | 0xa;

export interface WebSocketFrame {
  fin: boolean;
  opcode: FrameOpcode;
  masked: boolean;
  payload: Buffer;
}

export interface FrameDecoderCallbacks {
  /** A complete (possibly reassembled) data message. */
  onMessage(data: Buffer, binary: boolean): void;
  /** A close frame with its payload. */
  onClose(code: number, reason: string): void;
  /** A ping frame — the server must reply with a pong carrying the same payload. */
  onPing(payload: Buffer): void;
  /** A pong frame (heartbeat reply). */
  onPong(payload: Buffer): void;
  /** A protocol error — the connection must be torn down. */
  onError(message: string): void;
}

const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;
const OPCODE_CONTINUATION = 0x0;

/**
 * Encode a single server->client frame. Server frames are never masked
 * (per RFC 6455 §5.1) and use the given opcode and FIN bit.
 */
export function encodeFrame(opcode: FrameOpcode, payload: Buffer | string, fin = true): Buffer {
  const data = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  const header = Buffer.alloc(2);
  header[0] = (fin ? 0x80 : 0x00) | (opcode & 0x0f);

  let extended = Buffer.alloc(0);
  if (data.length < 126) {
    header[1] = data.length;
  } else if (data.length < 65536) {
    header[1] = 126;
    extended = Buffer.alloc(2);
    extended.writeUInt16BE(data.length, 0);
  } else {
    header[1] = 127;
    extended = Buffer.alloc(8);
    extended.writeBigUInt64BE(BigInt(data.length), 0);
  }

  return Buffer.concat([header, extended, data]);
}

/**
 * Parse a close-frame payload into a numeric code and a UTF-8 reason string.
 */
export function parseClosePayload(payload: Buffer): { code: number; reason: string } {
  if (payload.length === 0) return { code: 1000, reason: "" };
  if (payload.length === 1) return { code: 1002, reason: "invalid close payload" };
  const code = payload.readUInt16BE(0);
  const reason = payload.subarray(2).toString("utf8");
  return { code, reason };
}

/**
 * Stateful RFC 6455 frame decoder. Feed it raw bytes with `push`; it will
 * invoke callbacks as complete frames/messages are assembled.
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentBinary = false;
  private closed = false;

  constructor(private readonly callbacks: FrameDecoderCallbacks) {}

  /** Feed a chunk of raw bytes from the socket into the decoder. */
  push(chunk: Buffer): void {
    if (this.closed) return;
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    this.drain();
  }

  /** Mark the connection closed; no further frames will be emitted. */
  reset(): void {
    this.closed = true;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
  }

  private drain(): void {
    // Need at least 2 bytes for the base header.
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      if (first === undefined || second === undefined) break;

      const fin = (first & 0x80) !== 0;
      const opcode = (first & 0x0f) as FrameOpcode;
      const masked = (second & 0x80) !== 0;
      let payloadLength = second & 0x7f;

      let offset = 2;
      if (payloadLength === 126) {
        if (this.buffer.length < 4) return;
        payloadLength = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (this.buffer.length < 10) return;
        const big = this.buffer.readBigUInt64BE(2);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
          this.fail("payload length exceeds safe integer");
          return;
        }
        payloadLength = Number(big);
        offset = 10;
      }

      const maskLength = masked ? 4 : 0;
      if (this.buffer.length < offset + maskLength + payloadLength) {
        return; // incomplete frame, wait for more bytes
      }

      let payload = this.buffer.subarray(offset + maskLength, offset + maskLength + payloadLength);
      if (masked) {
        const mask = this.buffer.subarray(offset, offset + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i += 1) {
          const maskByte = mask[i % 4];
          if (maskByte !== undefined) payload[i] = payload[i]! ^ maskByte;
        }
      }

      this.buffer = this.buffer.subarray(offset + maskLength + payloadLength);
      this.handleFrame(fin, opcode, masked, payload);
      if (this.closed) return;
    }
  }

  private handleFrame(fin: boolean, opcode: FrameOpcode, masked: boolean, payload: Buffer): void {
    // RFC 6455 §5.1: client frames MUST be masked.
    if (!masked && opcode !== OPCODE_PONG && opcode !== OPCODE_PING) {
      // Server frames are unmasked; but the server decoder only receives client
      // frames, so any unmasked data frame here is a protocol violation.
      if (opcode === OPCODE_TEXT || opcode === OPCODE_BINARY || opcode === OPCODE_CONTINUATION) {
        this.fail("client frame must be masked");
        return;
      }
    }

    switch (opcode) {
      case OPCODE_TEXT:
      case OPCODE_BINARY:
        if (this.fragments.length > 0) {
          this.fail("new data frame during fragmented message");
          return;
        }
        if (fin) {
          this.callbacks.onMessage(payload, opcode === OPCODE_BINARY);
        } else {
          this.fragments = [payload];
          this.fragmentBinary = opcode === OPCODE_BINARY;
        }
        return;

      case OPCODE_CONTINUATION:
        if (this.fragments.length === 0) {
          this.fail("continuation frame without a started message");
          return;
        }
        this.fragments.push(payload);
        if (fin) {
          const complete = Buffer.concat(this.fragments);
          this.callbacks.onMessage(complete, this.fragmentBinary);
          this.fragments = [];
        }
        return;

      case OPCODE_CLOSE:
        this.callbacks.onClose(parseClosePayload(payload).code, parseClosePayload(payload).reason);
        return;

      case OPCODE_PING:
        this.callbacks.onPing(payload);
        return;

      case OPCODE_PONG:
        this.callbacks.onPong(payload);
        return;

      default:
        this.fail(`unsupported opcode: ${opcode}`);
        return;
    }
  }

  private fail(message: string): void {
    this.callbacks.onError(message);
    this.reset();
  }
}
