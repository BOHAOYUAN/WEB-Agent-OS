export interface SseEvent {
  data: string;
  event?: string;
  id?: string;
}

export interface SseDecoderOptions {
  maxBufferChars?: number;
}

const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;
const EVENT_BOUNDARY = /\r\n\r\n|\n\n|\r\r/;

function parseBlock(block: string): SseEvent | null {
  if (!block.trim()) return null;
  const dataLines: string[] = [];
  let eventName: string | undefined;
  let id: string | undefined;

  for (const rawLine of block.split(/\r\n|\r|\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    const colon = rawLine.indexOf(":");
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    let value = colon === -1 ? "" : rawLine.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
    else if (field === "event") eventName = value;
    else if (field === "id") id = value;
    // retry is irrelevant to the sensor
  }

  if (dataLines.length === 0 && eventName === undefined) return null;
  const event: SseEvent = { data: dataLines.join("\n") };
  if (eventName !== undefined) event.event = eventName;
  if (id !== undefined) event.id = id;
  return event;
}

function parseLine(line: string): SseEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return null;
  if (trimmed.startsWith("data:")) return { data: trimmed.slice(5).trim() };
  return { data: trimmed };
}

/**
 * Tolerant SSE decoder. DeepSeek speaks standard SSE (blank-line separated
 * "data:" frames), but we also accept line-delimited JSON when the stream does
 * not use "data:" prefixes. It never throws on malformed content.
 */
export class SseDecoder {
  private buffer = "";
  private mode: "unknown" | "sse" | "ndjson" = "unknown";
  private readonly maxBufferChars: number;
  private overflowedFlag = false;

  constructor(options: SseDecoderOptions = {}) {
    this.maxBufferChars = options.maxBufferChars ?? DEFAULT_MAX_BUFFER;
  }

  get overflowed(): boolean {
    return this.overflowedFlag;
  }

  push(chunk: string): SseEvent[] {
    if (this.overflowedFlag || chunk.length === 0) return [];
    this.buffer += chunk;
    if (this.buffer.length > this.maxBufferChars) {
      this.overflowedFlag = true;
      this.buffer = "";
      return [];
    }
    return this.drain();
  }

  end(): SseEvent[] {
    if (this.overflowedFlag) return [];
    const out: SseEvent[] = [];

    if (this.mode === "ndjson") {
      out.push(...this.drainNdjson(true));
      return out;
    }

    const tail = this.buffer;
    this.buffer = "";
    if (!tail.trim()) return out;

    if (this.mode === "unknown" && !tail.includes("data:")) {
      out.push(...this.parseLines(tail.split(/\r\n|\r|\n/)));
      return out;
    }

    const event = parseBlock(tail);
    if (event) out.push(event);
    return out;
  }

  private drain(): SseEvent[] {
    const out: SseEvent[] = [];
    for (;;) {
      this.detectMode();
      if (this.mode === "ndjson") {
        out.push(...this.drainNdjson(false));
        return out;
      }

      const match = EVENT_BOUNDARY.exec(this.buffer);
      if (!match) break;
      const block = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const event = parseBlock(block);
      if (event) out.push(event);
    }
    return out;
  }

  private drainNdjson(final: boolean): SseEvent[] {
    const out: SseEvent[] = [];
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) {
        if (final) {
          const rest = this.buffer;
          this.buffer = "";
          out.push(...this.parseLines([rest]));
        }
        break;
      }
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      out.push(...this.parseLines([line]));
    }
    return out;
  }

  private parseLines(lines: string[]): SseEvent[] {
    const out: SseEvent[] = [];
    for (const line of lines) {
      const event = parseLine(line);
      if (event) out.push(event);
    }
    return out;
  }

  private detectMode(): void {
    if (this.mode !== "unknown") return;
    const newline = this.buffer.indexOf("\n");
    const firstLine = (newline === -1 ? this.buffer : this.buffer.slice(0, newline)).replace(/\r$/, "").trim();
    if (!firstLine) return;
    if (
      firstLine.startsWith("data:") ||
      firstLine.startsWith(":") ||
      firstLine.startsWith("event:") ||
      firstLine.startsWith("id:") ||
      firstLine.startsWith("retry:")
    ) {
      this.mode = "sse";
      return;
    }
    if (firstLine.startsWith("{") || firstLine.startsWith("[")) {
      this.mode = "ndjson";
      return;
    }
    if (newline !== -1) this.mode = "sse";
  }
}
