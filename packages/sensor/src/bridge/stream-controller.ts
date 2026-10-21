import { LIMITS, SseDecoder, deepSeekAdapter } from "@webos/shared";
import type { EndReason, RawFrame, SensorEvent } from "@webos/shared";

/**
 * Owns one completion stream: raw text -> SSE events -> DeepSeek normalizer.
 * Lives in the isolated world, so it survives service-worker suspension.
 */
export class StreamController {
  private readonly decoder: SseDecoder;
  private readonly normalizer;
  private readonly requestId: string;
  private rawSeq = 0;
  private chars = 0;
  private ended = false;

  constructor(
    requestId: string,
    thinkingEnabled: boolean,
    private readonly emit: (event: SensorEvent) => void,
    private readonly storeRaw: (frame: RawFrame) => void,
  ) {
    this.requestId = requestId;
    this.decoder = new SseDecoder({ maxBufferChars: LIMITS.maxSseFrameChars });
    this.normalizer = deepSeekAdapter.createNormalizer({ requestId, thinkingEnabled, emit });
  }

  push(chunk: string): void {
    if (this.ended) return;
    this.chars += chunk.length;
    if (this.chars > LIMITS.maxStreamChars) {
      this.emit({
        type: "sensor.error",
        requestId: this.requestId,
        code: "stream-too-large",
        message: "Completion stream exceeded the capture limit",
        fatal: true,
      });
      this.end("error");
      return;
    }

    if (__DEV__) {
      this.storeRaw({
        requestId: this.requestId,
        seq: this.rawSeq,
        at: Date.now(),
        text: chunk.slice(0, LIMITS.rawFrameMaxChars),
      });
      this.rawSeq += 1;
    }

    for (const event of this.decoder.push(chunk)) this.normalizer.pushData(event.data);

    if (this.decoder.overflowed) {
      this.emit({
        type: "sensor.error",
        requestId: this.requestId,
        code: "stream-too-large",
        message: "SSE frame buffer overflowed",
        fatal: true,
      });
      this.end("error");
    }
  }

  end(reason: EndReason): void {
    if (this.ended) return;
    this.ended = true;
    for (const event of this.decoder.end()) this.normalizer.pushData(event.data);
    this.normalizer.end(reason);
  }
}
