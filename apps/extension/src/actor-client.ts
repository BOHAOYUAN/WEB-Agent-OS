/**
 * WebSocket client for the local Actor bridge.
 *
 * This is the ONLY file in the extension allowed to open a WebSocket
 * (see scripts/arch-check.mjs). It lives in the SIDE PANEL — not the service
 * worker — because the panel stays open while the user interacts, making a
 * long-lived connection and manual reconnect reliable. MV3 service workers are
 * reclaimed after ~30s of idle time and would drop the socket.
 *
 * Red lines:
 *  - the endpoint is hard-coded to `ws://127.0.0.1:<port>` — no other host can
 *    ever be dialed (enforced by `url()` plus unit tests);
 *  - the token travels in the query string and is NEVER logged or surfaced;
 *  - every outbound command is keyed by `id`, and responses are matched back
 *    by that id (the Actor bridge may interleave responses if reused later).
 */

import type { ActorCommand, ActorResult } from "@webos/shared";

export type ActorState = "disconnected" | "connecting" | "connected" | "error";

export interface ActorClientOptions {
  /** The reusable handshake token copied from the Actor CLI banner. */
  token: string;
  /** Bridge port. Defaults to 4319; only 127.0.0.1 is ever used. */
  port?: number;
  /** Per-command response timeout. */
  timeoutMs?: number;
  /** Connection state callback for the UI. */
  onStateChange?: (state: ActorState, detail: string) => void;
}

export const ACTOR_DEFAULT_PORT = 4319;
export const ACTOR_DEFAULT_TIMEOUT_MS = 30_000;

interface Pending {
  resolve: (result: ActorResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ActorClient {
  private ws: WebSocket | null = null;
  private state: ActorState = "disconnected";
  private readonly pending = new Map<string, Pending>();
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: ActorClientOptions) {
    this.port = options.port ?? ACTOR_DEFAULT_PORT;
    this.timeoutMs = options.timeoutMs ?? ACTOR_DEFAULT_TIMEOUT_MS;
  }

  get connectionState(): ActorState {
    return this.state;
  }

  /** The dialed URL. Only ever `ws://127.0.0.1:<port>/?token=…`. */
  url(): string {
    return `ws://127.0.0.1:${this.port}/?token=${encodeURIComponent(this.options.token)}`;
  }

  connect(): void {
    if (this.ws) return;
    this.setState("connecting", `连接 ws://127.0.0.1:${this.port} …`);

    const ws = new WebSocket(this.url());
    this.ws = ws;

    ws.onopen = () => this.setState("connected", `已连接 127.0.0.1:${this.port}`);
    ws.onmessage = (event) => this.handleMessage(event.data);
    ws.onerror = () => this.setState("error", "连接错误（Actor 进程是否在运行？）");
    ws.onclose = () => {
      // Guard against a reconnect that already replaced this socket.
      if (this.ws === ws) this.ws = null;
      this.rejectAll("连接已断开");
      this.setState("disconnected", "连接已断开");
    };
  }

  disconnect(): void {
    this.rejectAll("已手动断开");
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      // Detach handlers so the close event does not double-report.
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
    this.setState("disconnected", "已断开");
  }

  /** Send a command and resolve with the matching result (by id). */
  send(command: ActorCommand): Promise<ActorResult> {
    if (this.ws === null || this.state !== "connected") {
      return Promise.reject(new Error("未连接 Actor"));
    }
    return new Promise<ActorResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(command.id);
        reject(new Error("命令超时（" + this.timeoutMs + "ms）"));
      }, this.timeoutMs);
      this.pending.set(command.id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify(command));
    });
  }

  private handleMessage(data: unknown): void {
    let parsed: ActorResult;
    try {
      parsed = JSON.parse(typeof data === "string" ? data : String(data)) as ActorResult;
    } catch {
      return;
    }
    const pending = this.pending.get(parsed.id);
    if (!pending) return;
    this.pending.delete(parsed.id);
    clearTimeout(pending.timer);
    pending.resolve(parsed);
  }

  private rejectAll(message: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
      this.pending.delete(id);
    }
  }

  private setState(state: ActorState, detail: string): void {
    this.state = state;
    this.options.onStateChange?.(state, detail);
  }
}

let counter = 0;

/** Generate a fresh command id (unique within the page). */
export function nextCommandId(): string {
  counter += 1;
  return `cmd-${Date.now().toString(36)}-${counter}`;
}
