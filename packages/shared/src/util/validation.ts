import { LIMITS } from "../constants.js";
import type { SensorEvent } from "../types/events.js";
import type { BridgeToMainEnvelope, BridgeToMainMessage, MainEnvelope, SensorBatch } from "../types/messages.js";

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
      typeof value.prompt === "string" &&
      value.prompt.length > 0 &&
      value.prompt.length <= LIMITS.maxInjectPromptChars
    );
  }
  if (value.kind === "webos/inject.disarm") {
    return value.v === 1;
  }
  return false;
}
