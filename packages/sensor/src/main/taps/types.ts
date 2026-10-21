import type { SensorErrorCode, SystemContext, Transport } from "@webos/shared";

/** Consumable source of a pending system-context injection (armed by the bridge). */
export interface PromptInjector {
  /** Read the pending injection without clearing it. */
  peek(): { version: number; context: SystemContext } | null;
  /** Clear the pending injection only if its version still matches. */
  consume(version: number): void;
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
  onUserPrompt?(requestId: string, text: string): void;
}

/** Mutable capture switch shared between the reverse channel and the taps. */
export interface MemoryCaptureState {
  enabled: boolean;
}

export interface TapInstallOptions extends TapCallbacks {
  baseHref?: string;
  injector?: PromptInjector;
  memoryCapture?: MemoryCaptureState;
}
