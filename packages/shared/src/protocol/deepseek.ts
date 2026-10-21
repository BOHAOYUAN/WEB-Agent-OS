import type { EndReason, SensorEvent } from "../types/events.js";
import type { NormalizerFactoryOptions, StreamNormalizer } from "../types/adapter.js";
import { isRecord } from "../util/validation.js";

type FragmentType = "THINK" | "RESPONSE";

interface FragmentState {
  type: FragmentType;
  content: string;
  /** Number of characters already emitted as deltas. */
  emitted: number;
}

export type DeepSeekNormalizerOptions = NormalizerFactoryOptions;

function normalizeType(value: unknown): FragmentType {
  return typeof value === "string" && value.toUpperCase() === "THINK" ? "THINK" : "RESPONSE";
}

function contentOf(item: Record<string, unknown>): string {
  if (typeof item.content === "string") return item.content;
  if (typeof item.text === "string") return item.text;
  return "";
}

function isFragmentField(field: string): boolean {
  return field === "content" || field === "text" || field === "markdown" || field === "delta";
}

function isThinkField(field: string): boolean {
  return field === "reasoning_content" || field === "thinking_content";
}

/**
 * Normalizes DeepSeek's patch/snapshot stream into monotonic per-channel deltas.
 *
 * Observed frame families (see docs/protocol-deepseek.md):
 *  - snapshot:  {"v":{"response":{"fragments":[{type,content},...]}}}
 *  - new frag:  {"p":"response/fragments","o":"APPEND","v":[{type,content},...]}
 *  - path delta:{"p":"response/fragments/-1/content","o":"APPEND","v":"..."}
 *  - bare delta:{"v":"..."}   (the majority of answer text)
 *  - status:    {"p":"response/status","v":"FINISHED"|"INCOMPLETE"}
 *  - error:     {"code":...,"msg":...} / {"data":{"biz_code":...}}
 */
export class DeepSeekNormalizer implements StreamNormalizer {
  private readonly requestId: string;
  private readonly thinkingEnabled: boolean;
  private readonly emitEvent: (event: SensorEvent) => void;
  private readonly now: () => number;

  private fragments: FragmentState[] = [];
  private currentIndex = -1;
  private orphan = "";
  private finished = false;
  private lastRequestMessageId: number | string | undefined;
  private lastResponseMessageId: number | string | undefined;
  private emittedMeta = false;

  constructor(options: DeepSeekNormalizerOptions) {
    this.requestId = options.requestId;
    this.thinkingEnabled = options.thinkingEnabled;
    this.emitEvent = options.emit;
    this.now = options.now ?? (() => Date.now());
  }

  pushData(data: string): void {
    if (this.finished) return;
    const trimmed = data.trim();
    if (!trimmed) return;
    if (trimmed === "[DONE]") {
      this.finish("finished");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      this.nonFatal("protocol-frame-error", "Malformed JSON frame");
      return;
    }
    this.consume(parsed);
  }

  end(reason: EndReason): void {
    this.finish(reason);
  }

  private consume(value: unknown): void {
    if (!isRecord(value)) {
      this.nonFatal("protocol-frame-error", "Frame is not a JSON object");
      return;
    }

    if (typeof value.code === "number" && value.code !== 0 && value.p === undefined) {
      const message = typeof value.msg === "string" ? value.msg : `code=${value.code}`;
      this.fatal("protocol-frame-error", `Business error: ${message}`);
      return;
    }

    const data = value.data;
    if (isRecord(data) && typeof data.biz_code === "number" && data.biz_code !== 0) {
      const message = typeof data.biz_msg === "string" ? data.biz_msg : `biz_code=${data.biz_code}`;
      this.fatal("protocol-frame-error", `Business error: ${message}`);
      return;
    }

    const requestMessageId = value.request_message_id;
    if (typeof requestMessageId === "number" || typeof requestMessageId === "string") {
      this.emitMeta({ requestMessageId });
    }

    const v = value.v;
    const p = value.p;

    if (p === "response/status" || p === "quasi_status") {
      if (v === "FINISHED") this.finish("finished");
      else if (v === "INCOMPLETE") this.finish("incomplete");
      return;
    }

    if (p === "response/fragments" && value.o === "APPEND" && Array.isArray(v)) {
      this.onFragmentsAppend(v);
      return;
    }

    if (p === undefined && isRecord(v) && isRecord(v.response) && Array.isArray(v.response.fragments)) {
      const responseMessageId = v.response.message_id;
      if (typeof responseMessageId === "number" || typeof responseMessageId === "string") {
        this.emitMeta({ responseMessageId });
      }
      this.onSnapshot(v.response.fragments);
      return;
    }

    if (typeof p === "string") {
      this.onPath(p, value.o, v);
      return;
    }

    if (typeof v === "string" && value.o !== "SET") {
      this.onBareText(v);
    }
  }

  private onFragmentsAppend(items: unknown[]): void {
    for (const item of items) {
      if (!isRecord(item)) continue;
      const type = normalizeType(item.type);
      const content = contentOf(item);
      const index = this.fragments.length;
      this.fragments.push({ type, content: "", emitted: 0 });
      this.currentIndex = index;
      this.flushOrphanInto(index);
      if (content) this.appendContent(index, content);
    }
  }

  private onSnapshot(items: unknown[]): void {
    const previous = this.fragments;
    const next: FragmentState[] = [];
    let hasContent = false;

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!isRecord(item)) {
        next.push({ type: "RESPONSE", content: "", emitted: 0 });
        continue;
      }
      const content = contentOf(item);
      if (content.length > 0) hasContent = true;
      const prior = previous[i];
      next.push({
        type: normalizeType(item.type),
        content,
        emitted: prior ? Math.min(prior.emitted, content.length) : 0,
      });
    }

    this.fragments = next;
    this.currentIndex = next.length - 1;
    // A snapshot with content is authoritative; do not append orphan text twice.
    if (hasContent) this.orphan = "";

    for (let i = 0; i < next.length; i += 1) this.emitSuffix(i);

    if (!hasContent && next.length > 0) {
      this.flushOrphanInto(Math.max(0, this.currentIndex));
    }
  }

  private onPath(path: string, op: unknown, value: unknown): void {
    const match = /^response\/fragments\/(-?\d+)\/([A-Za-z_]+)$/.exec(path);
    if (!match) return;
    const rawIndex = Number(match[1]);
    const field = match[2] ?? "";
    const index = this.resolveIndex(rawIndex);

    if (field === "type") {
      if (typeof value === "string") {
        this.ensure(index, normalizeType(value));
        const fragment = this.fragments[index];
        if (fragment) fragment.type = normalizeType(value);
      }
      return;
    }

    if (!isFragmentField(field) && !isThinkField(field)) return;

    const type: FragmentType = isThinkField(field) ? "THINK" : (this.fragments[index]?.type ?? "RESPONSE");
    this.ensure(index, type);
    if (typeof value !== "string") return;

    if (op === "SET") this.setContent(index, value);
    else this.appendContent(index, value);
  }

  private onBareText(text: string): void {
    if (this.fragments.length === 0) {
      if (this.thinkingEnabled) {
        this.orphan += text;
        return;
      }
      this.fragments.push({ type: "RESPONSE", content: "", emitted: 0 });
      this.currentIndex = 0;
    }
    const index = this.currentIndex >= 0 ? this.currentIndex : this.fragments.length - 1;
    this.appendContent(index, text);
  }

  private appendContent(index: number, text: string): void {
    const fragment = this.fragments[index];
    if (!fragment || text.length === 0) return;
    fragment.content += text;
    this.emitSuffix(index);
  }

  private setContent(index: number, text: string): void {
    const fragment = this.fragments[index];
    if (!fragment) return;
    fragment.content = text;
    if (fragment.emitted > text.length) fragment.emitted = text.length;
    this.emitSuffix(index);
  }

  private emitSuffix(index: number): void {
    const fragment = this.fragments[index];
    if (!fragment) return;
    if (fragment.content.length <= fragment.emitted) return;
    const text = fragment.content.slice(fragment.emitted);
    fragment.emitted = fragment.content.length;
    this.emitEvent({
      type: "sensor.text.delta",
      requestId: this.requestId,
      channel: fragment.type === "THINK" ? "thinking" : "answer",
      text,
    });
  }

  private ensure(index: number, type: FragmentType): void {
    while (this.fragments.length <= index) {
      this.fragments.push({ type: "RESPONSE", content: "", emitted: 0 });
    }
    const fragment = this.fragments[index];
    if (fragment && fragment.type !== type && fragment.content.length === 0) fragment.type = type;
  }

  private resolveIndex(rawIndex: number): number {
    if (rawIndex < 0) return this.fragments.length > 0 ? this.fragments.length - 1 : 0;
    return rawIndex;
  }

  private flushOrphanInto(index: number): void {
    if (this.orphan.length === 0) return;
    const text = this.orphan;
    this.orphan = "";
    this.ensure(index, this.fragments[index]?.type ?? "RESPONSE");
    const fragment = this.fragments[index];
    if (!fragment) return;
    fragment.content += text;
    this.emitSuffix(index);
  }

  private finish(reason: EndReason): void {
    if (this.finished) return;
    this.flushOrphan();
    this.finished = true;
    this.emitEvent({ type: "sensor.stream.end", requestId: this.requestId, reason, ts: this.now() });
  }

  private flushOrphan(): void {
    if (this.orphan.length === 0) return;
    if (this.fragments.length === 0) {
      this.fragments.push({ type: this.thinkingEnabled ? "THINK" : "RESPONSE", content: "", emitted: 0 });
      this.currentIndex = 0;
    }
    const index = this.currentIndex >= 0 ? this.currentIndex : this.fragments.length - 1;
    this.flushOrphanInto(index);
  }

  private emitMeta(fields: { requestMessageId?: number | string; responseMessageId?: number | string }): void {
    const requestMessageId = fields.requestMessageId ?? this.lastRequestMessageId;
    const responseMessageId = fields.responseMessageId ?? this.lastResponseMessageId;
    if (
      this.emittedMeta &&
      requestMessageId === this.lastRequestMessageId &&
      responseMessageId === this.lastResponseMessageId
    ) {
      return;
    }
    this.lastRequestMessageId = requestMessageId;
    this.lastResponseMessageId = responseMessageId;
    this.emittedMeta = true;
    const event: SensorEvent = { type: "sensor.stream.meta", requestId: this.requestId };
    if (requestMessageId !== undefined) event.requestMessageId = requestMessageId;
    if (responseMessageId !== undefined) event.responseMessageId = responseMessageId;
    this.emitEvent(event);
  }

  private nonFatal(code: "protocol-frame-error", message: string): void {
    this.emitEvent({ type: "sensor.error", requestId: this.requestId, code, message, fatal: false });
  }

  private fatal(code: "protocol-frame-error", message: string): void {
    this.orphan = "";
    this.emitEvent({ type: "sensor.error", requestId: this.requestId, code, message, fatal: true });
    this.finish("error");
  }
}
