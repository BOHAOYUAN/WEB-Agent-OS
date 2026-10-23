import type { SensorErrorCode, SensorEvent, Transport } from "./events.js";
import type { SystemContext } from "./memory.js";
import type { Artifact, ArtifactFeedback, ArtifactScope } from "./artifacts.js";
import type { PageActConfirmRequest } from "./page-act.js";

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
  | { kind: "webos/memory.transcript.request"; tabId: number }
  | { kind: "webos/artifacts.request"; tabId: number; scope?: ArtifactScope }
  /** Relayed by the side panel from the artifact sandbox page. */
  | { kind: "webos/artifact.feedback"; tabId: number; feedback: ArtifactFeedback }
  | { kind: "webos/artifact.feedback.get"; tabId: number }
  /** PageAct: the content script asks the worker for a user decision. */
  | { kind: "webos/pageact.confirm.request"; request: PageActConfirmRequest }
  /** PageAct: the side panel relays the user's answer. */
  | { kind: "webos/pageact.confirm.response"; id: string; approved: boolean }
  /** PageAct: run a batch of actions in a tab. */
  | { kind: "webos/pageact.run"; tabId: number; actions: unknown };

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
  | { kind: "webos/memory.set-capture"; v: 1; enabled: boolean }
  | { kind: "webos/pageact.run"; v: 1; actions: unknown };

/** What the content script answers after running a batch. */
export interface PageActRunResponse {
  kind: "webos/pageact.run.result";
  ok: boolean;
  /** One entry per action, in order. */
  results?: unknown[];
  error?: string;
}

export interface MemoryTranscriptResponse {
  kind: "webos/memory.transcript.result";
  transcript: string;
  turns: number;
  chars: number;
  hasUserPrompts: boolean;
  pageSessionId: string;
}

export interface ArtifactsResponse {
  kind: "webos/artifacts.result";
  artifacts: Artifact[];
  answerChars: number;
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
  | { kind: "webos/ui.batch"; tabId: number; batch: SensorBatch }
  | {
      kind: "webos/ui.artifacts";
      tabId: number;
      pageSessionId: string;
      artifacts: Artifact[];
      answerChars: number;
    }
  /** A dangerous action is waiting for the user's decision. */
  | { kind: "webos/ui.pageact.confirm"; request: PageActConfirmRequest }
  /** A model-proposed batch finished (or failed) — pushed so the console can
   *  show the outcome even though the model, not the console, was the caller. */
  | {
      kind: "webos/ui.pageact.result";
      tabId: number;
      actions: unknown;
      outcome: { ok: boolean; results?: unknown[]; error?: string };
    };
