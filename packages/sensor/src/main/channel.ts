import type { MainEnvelope, MainToBridgeMessage, SensorErrorCode, Transport } from "@webos/shared";

export interface SensorChannel {
  ready(): void;
  start(start: {
    requestId: string;
    transport: Transport;
    endpoint: string;
    thinkingEnabled: boolean;
    injectionVersion?: number;
  }): void;
  chunk(requestId: string, chunk: string): void;
  end(requestId: string, reason: "aborted" | "transport-closed" | "error"): void;
  tapError(requestId: string | undefined, code: SensorErrorCode, message: string, fatal: boolean): void;
  userPrompt(requestId: string, text: string): void;
}

function ensureDataset(key: string): string {
  const root = document.documentElement;
  const existing = root?.dataset[key];
  if (existing) return existing;
  const value = crypto.randomUUID();
  if (root) root.dataset[key] = value;
  return value;
}

function post(message: MainToBridgeMessage, nonce: string): void {
  const envelope: MainEnvelope = { source: "webos.sensor.main", v: 1, nonce, message };
  try {
    window.postMessage(envelope, location.origin);
  } catch {
    // Never break the page because the bridge is unavailable.
  }
}

export function createChannel(): SensorChannel {
  const nonce = ensureDataset("webosNonce");
  const pageSessionId = ensureDataset("webosPageSession");

  return {
    ready(): void {
      post({ kind: "webos/sensor.ready", v: 1, pageSessionId }, nonce);
    },
    start(start): void {
      const payload: MainToBridgeMessage = {
        kind: "webos/sensor.start",
        v: 1,
        pageSessionId,
        requestId: start.requestId,
        transport: start.transport,
        endpoint: start.endpoint,
        thinkingEnabled: start.thinkingEnabled,
        ts: Date.now(),
      };
      if (start.injectionVersion !== undefined) payload.injectionVersion = start.injectionVersion;
      post(payload, nonce);
    },
    chunk(requestId, chunk): void {
      if (!chunk) return;
      post({ kind: "webos/sensor.chunk", v: 1, pageSessionId, requestId, chunk }, nonce);
    },
    end(requestId, reason): void {
      post({ kind: "webos/sensor.end", v: 1, pageSessionId, requestId, reason, ts: Date.now() }, nonce);
    },
    tapError(requestId, code, message, fatal): void {
      const payload: MainToBridgeMessage = {
        kind: "webos/sensor.tap-error",
        v: 1,
        pageSessionId,
        code,
        message,
        fatal,
      };
      if (requestId !== undefined) payload.requestId = requestId;
      post(payload, nonce);
    },
    userPrompt(requestId, text): void {
      if (!text) return;
      post({ kind: "webos/memory.user-prompt", v: 1, pageSessionId, requestId, text, ts: Date.now() }, nonce);
    },
  };
}
