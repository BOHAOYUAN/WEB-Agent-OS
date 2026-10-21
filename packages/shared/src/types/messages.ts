import type { SensorErrorCode, SensorEvent, Transport } from "./events.js";
import type { SystemContext } from "./memory.js";

export type MainToBridgeMessage =
  | { kind: "webos/sensor.ready"; v: 1; pageSessionId: string }
  | {
      kind: "webos/sensor.start";
      v: 1;
      pageSessionId: string;
      requestId: string;
      transport: Transport;
      endpoint: string;
      thinkingEnabled: boolean;
      ts: number;
      injectionVersion?: number;
    }
  | { kind: "webos/sensor.chunk"; v: 1; pageSessionId: string; requestId: string; chunk: string }
  | {
      kind: "webos/sensor.end";
      v: 1;
      pageSessionId: string;
      requestId: string;
      reason: "aborted" | "transport-closed" | "error";
      ts: number;
    }
  | {
      kind: "webos/sensor.tap-error";
      v: 1;
      pageSessionId: string;
      requestId?: string;
      code: SensorErrorCode;
      message: string;
      fatal: boolean;
    }
  | {
      kind: "webos/memory.user-prompt";
      v: 1;
      pageSessionId: string;
      requestId: string;
      text: string;
      ts: number;
    };

export interface MainEnvelope {
  source: "webos.sensor.main";
  v: 1;
  nonce: string;
  message: MainToBridgeMessage;
}

/** Reverse channel: messages pushed from the bridge (ISOLATED) to main (MAIN). */
export type BridgeToMainMessage =
  | { kind: "webos/inject.arm"; v: 1; version: number; context: SystemContext }
  | { kind: "webos/inject.disarm"; v: 1 }
  | { kind: "webos/memory.set-capture"; v: 1; enabled: boolean };

export interface BridgeToMainEnvelope {
  source: "webos.sensor.bridge";
  v: 1;
  nonce: string;
  message: BridgeToMainMessage;
}

export interface SensorBatch {
  v: 1;
  pageSessionId: string;
  seq: number;
  events: SensorEvent[];
}

export interface RawFrame {
  requestId: string;
  seq: number;
  at: number;
  text: string;
}

export interface BridgeDump {
  v: 1;
  pageSessionId: string;
  frames: RawFrame[];
}

/** Messages sent from a content script (or the side panel) to the service worker. */
export type RuntimeMessage =
  | { kind: "webos/sensor.batch"; batch: SensorBatch }
  | { kind: "webos/capture.dump.request"; tabId: number }
  | { kind: "webos/ui.clear" }
  | { kind: "webos/router.set-enabled"; enabled: boolean }
  | { kind: "webos/router.get-enabled" }
  | { kind: "webos/memory.arm"; tabId: number; text: string }
  | { kind: "webos/memory.disarm"; tabId: number }
  | { kind: "webos/memory.capture.set"; tabId: number; enabled: boolean }
  | { kind: "webos/memory.capture.get" }
  | { kind: "webos/memory.clear-captured"; tabId: number }
  | { kind: "webos/memory.transcript.request"; tabId: number };

export interface CaptureDumpResponse {
  kind: "webos/capture.dump.result";
  dump: BridgeDump | null;
  error?: string;
}

/** Messages sent from the service worker to a content script. */
export type ContentMessage =
  | { kind: "webos/capture.dump" }
  | { kind: "webos/inject.arm"; v: 1; pageSessionId: string; context: SystemContext }
  | { kind: "webos/inject.disarm"; v: 1; pageSessionId: string; target: "persona" | "memory" | "all" }
  | { kind: "webos/memory.set-capture"; v: 1; enabled: boolean };

export interface MemoryTranscriptResponse {
  kind: "webos/memory.transcript.result";
  transcript: string;
  turns: number;
  chars: number;
  hasUserPrompts: boolean;
  pageSessionId: string;
}

export interface ContentResponse {
  kind: "webos/capture.dump.result";
  dump: BridgeDump;
}

export type UiClientMessage = { kind: "webos/ui.hello" } | { kind: "webos/ui.clear" };

export interface UiSessionSnapshot {
  tabId: number;
  pageSessionId: string;
  events: SensorEvent[];
  updatedAt: number;
}

export type UiMessage =
  | { kind: "webos/ui.snapshot"; sessions: UiSessionSnapshot[] }
  | { kind: "webos/ui.batch"; tabId: number; batch: SensorBatch };
