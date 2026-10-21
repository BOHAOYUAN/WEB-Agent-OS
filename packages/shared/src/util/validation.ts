import { LIMITS } from "../constants.js";
import type { SensorEvent } from "../types/events.js";
import type { BridgeToMainEnvelope, BridgeToMainMessage, MainEnvelope, SensorBatch } from "../types/messages.js";
import { isMemorySource, isMemorySummary, isSystemContext } from "../types/memory.js";
import { ACTOR_LIMITS, ACTOR_PROTOCOL_VERSION } from "../types/actor.js";
import type { ActorCommand } from "../types/actor.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberOrString(value: unknown): value is number | string {
  return typeof value === "number" || typeof value === "string";
}

export function isSensorEvent(value: unknown): value is SensorEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "sensor.stream.start":
      return (
        typeof value.requestId === "string" &&
        typeof value.ts === "number" &&
        (value.transport === "xhr" || value.transport === "fetch") &&
        typeof value.endpoint === "string" &&
        typeof value.thinkingEnabled === "boolean"
      );
    case "sensor.stream.meta":
      return (
        typeof value.requestId === "string" &&
        (value.requestMessageId === undefined || isNumberOrString(value.requestMessageId)) &&
        (value.responseMessageId === undefined || isNumberOrString(value.responseMessageId))
      );
    case "sensor.text.delta":
      return (
        typeof value.requestId === "string" &&
        (value.channel === "thinking" || value.channel === "answer") &&
        typeof value.text === "string"
      );
    case "sensor.stream.end":
      return (
        typeof value.requestId === "string" &&
        typeof value.ts === "number" &&
        (value.reason === "finished" ||
          value.reason === "incomplete" ||
          value.reason === "aborted" ||
          value.reason === "transport-closed" ||
          value.reason === "error")
      );
    case "sensor.error":
      return (
        (value.requestId === undefined || typeof value.requestId === "string") &&
        typeof value.code === "string" &&
        typeof value.message === "string" &&
        typeof value.fatal === "boolean"
      );
    case "sensor.user.prompt":
      return typeof value.requestId === "string" && typeof value.text === "string" && typeof value.ts === "number";
    default:
      return false;
  }
}

export function isSensorBatch(value: unknown): value is SensorBatch {
  if (!isRecord(value) || value.v !== 1) return false;
  if (typeof value.pageSessionId !== "string") return false;
  if (typeof value.seq !== "number" || !Number.isInteger(value.seq)) return false;
  if (!Array.isArray(value.events) || value.events.length > LIMITS.maxBatchEvents) return false;
  return value.events.every(isSensorEvent);
}

export function isMainEnvelope(value: unknown): value is MainEnvelope {
  return (
    isRecord(value) &&
    value.source === "webos.sensor.main" &&
    value.v === 1 &&
    typeof value.nonce === "string" &&
    isRecord(value.message) &&
    typeof value.message.kind === "string"
  );
}

export function isBridgeToMainEnvelope(value: unknown): value is BridgeToMainEnvelope {
  return (
    isRecord(value) &&
    value.source === "webos.sensor.bridge" &&
    value.v === 1 &&
    typeof value.nonce === "string" &&
    isRecord(value.message) &&
    typeof value.message.kind === "string"
  );
}

export function isInjectArmMessage(value: unknown): value is BridgeToMainMessage {
  if (!isRecord(value)) return false;
  if (value.kind === "webos/inject.arm") {
    return (
      value.v === 1 &&
      typeof value.version === "number" &&
      Number.isInteger(value.version) &&
      isSystemContext(value.context)
    );
  }
  if (value.kind === "webos/inject.disarm") {
    return value.v === 1;
  }
  return false;
}

export function isMemorySetCaptureMessage(value: unknown): value is { kind: "webos/memory.set-capture"; v: 1; enabled: boolean } {
  return isRecord(value) && value.kind === "webos/memory.set-capture" && value.v === 1 && typeof value.enabled === "boolean";
}

export type ActorCommandValidation =
  | { ok: true; command: ActorCommand }
  | { ok: false; reason: string };

/**
 * Validate an inbound Actor command against the v2 contract. This is the single
 * gate before a command is dispatched: it enforces the protocol version, the
 * per-kind required fields, and the transcript/timeout hard limits. Anything
 * that fails here is rejected without touching the shell or Ollama.
 */
export function validateActorCommand(value: unknown): ActorCommandValidation {
  if (!isRecord(value)) return { ok: false, reason: "not an object" };
  if (value.v !== ACTOR_PROTOCOL_VERSION) return { ok: false, reason: "protocol version mismatch" };
  if (typeof value.id !== "string" || value.id.length === 0) return { ok: false, reason: "missing id" };
  if (!Number.isInteger(value.timeoutMs)) return { ok: false, reason: "timeoutMs must be an integer" };
  const timeoutMs = value.timeoutMs as number;
  if (timeoutMs < ACTOR_LIMITS.minTimeoutMs || timeoutMs > ACTOR_LIMITS.maxTimeoutMs) {
    return { ok: false, reason: "timeoutMs out of range" };
  }

  if (value.kind === "exec") {
    if (value.runtime !== "node") return { ok: false, reason: "unsupported runtime" };
    if (typeof value.code !== "string" || value.code.length === 0) return { ok: false, reason: "missing code" };
    return { ok: true, command: value as ActorCommand };
  }

  if (value.kind === "memory-summary") {
    if (typeof value.transcript !== "string" || value.transcript.length === 0) return { ok: false, reason: "missing transcript" };
    if (value.transcript.length > ACTOR_LIMITS.maxTranscriptChars) return { ok: false, reason: "transcript too large" };
    return { ok: true, command: value as ActorCommand };
  }

  if (value.kind === "memory-store") {
    if (value.action === "save") {
      if (!isMemorySummary(value.memory)) return { ok: false, reason: "invalid memory" };
      if (typeof value.model !== "string" || value.model.length === 0) return { ok: false, reason: "missing model" };
      if (value.source !== undefined && !isMemorySource(value.source)) return { ok: false, reason: "invalid source" };
      return { ok: true, command: value as ActorCommand };
    }
    if (value.action === "get" || value.action === "clear") {
      return { ok: true, command: value as ActorCommand };
    }
    return { ok: false, reason: "unknown memory-store action" };
  }

  return { ok: false, reason: "unknown command kind" };
}
