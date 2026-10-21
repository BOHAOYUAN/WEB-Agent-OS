import { coalesceEvents, LIMITS } from "@webos/shared";
import type { SensorBatch, SensorEvent } from "@webos/shared";

/**
 * Batches normalized events on a timer and ships them to the service worker.
 * On extension-context invalidation it stops quietly instead of throwing into
 * the host page.
 */
export class SensorSender {
  private queue: SensorEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private disabled = false;

  constructor(
    private readonly pageSessionId: string,
    private readonly onDisabled: () => void,
  ) {}

  enqueue(event: SensorEvent): void {
    if (this.disabled) return;
    this.queue.push(event);
    if (this.queue.length >= LIMITS.bridgeFlushEvents) {
      this.flush();
      return;
    }
    this.arm();
  }

  flush(): void {
    this.clearTimer();
    if (this.disabled || this.queue.length === 0) return;

    const events = coalesceEvents(this.queue.splice(0, this.queue.length));
    if (events.length === 0) return;

    this.seq += 1;
    const batch: SensorBatch = { v: 1, pageSessionId: this.pageSessionId, seq: this.seq, events };
    try {
      chrome.runtime.sendMessage({ kind: "webos/sensor.batch", batch }, () => {
        if (chrome.runtime.lastError) this.disable();
      });
    } catch {
      this.disable();
    }
  }

  dispose(): void {
    this.clearTimer();
    this.queue = [];
    this.disable();
  }

  private arm(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, LIMITS.bridgeFlushMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private disable(): void {
    if (this.disabled) return;
    this.disabled = true;
    this.queue = [];
    this.clearTimer();
    this.onDisabled();
  }
}
