/**
 * WebSocket heartbeat (ping/pong keep-alive).
 *
 * Long-lived local bridge connections must survive idle periods and detect
 * dead peers. The server sends a ping on an interval and, if no pong arrives
 * within a grace window, declares the connection dead and tears it down.
 */

export interface HeartbeatOptions {
  /** Interval between pings in milliseconds. */
  intervalMs: number;
  /** How long to wait for a pong before declaring the peer dead. */
  timeoutMs: number;
  /** Send a ping frame. */
  onPing(payload: Buffer): void;
  /** Invoked when the peer is considered dead (missed pong). */
  onTimeout(): void;
}

export class Heartbeat {
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private readonly options: HeartbeatOptions) {}

  start(): void {
    if (this.stopped || this.intervalTimer !== null) return;
    this.intervalTimer = setInterval(() => {
      this.sendPing();
    }, this.options.intervalMs);
  }

  /** A pong (or any frame) was received — reset the dead-peer timer. */
  markAlive(): void {
    if (this.stopped) return;
    this.clearTimeout();
  }

  private sendPing(): void {
    if (this.stopped) return;
    // Payload carries a timestamp so the peer can echo it; heartbeat only needs
    // liveness, so a tiny nonce suffices.
    const payload = Buffer.from(String(Date.now()), "utf8");
    this.options.onPing(payload);
    this.clearTimeout();
    this.timeoutTimer = setTimeout(() => {
      if (this.stopped) return;
      this.options.onTimeout();
    }, this.options.timeoutMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.intervalTimer !== null) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.clearTimeout();
  }

  private clearTimeout(): void {
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }
}
