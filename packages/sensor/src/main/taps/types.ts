import type { SensorErrorCode, Transport } from "@webos/shared";

/** Consumable source of a pending persona injection (armed by the Router). */
export interface PromptInjector {
  /** Atomically take the pending injection, or null if none is armed. */
  consume(): { version: number; prompt: string } | null;
}

export interface TapStart {
  requestId: string;
  transport: Transport;
  endpoint: string;
  thinkingEnabled: boolean;
  ts: number;
  /** Present when this request consumed an armed persona injection. */
  injectionVersion?: number;
}

export type TapEndReason = "aborted" | "transport-closed" | "error";

export interface TapCallbacks {
  match(url: URL): boolean;
  onStart(start: TapStart): void;
  onChunk(requestId: string, chunk: string): void;
  onEnd(requestId: string, reason: TapEndReason): void;
  onError(requestId: string | undefined, code: SensorErrorCode, message: string, fatal: boolean): void;
}

export interface TapInstallOptions extends TapCallbacks {
  baseHref?: string;
  injector?: PromptInjector;
}
