import { LIMITS, RingBuffer, isMainEnvelope, isSystemContext } from "@webos/shared";
import type { BridgeDump, MainToBridgeMessage, RawFrame, SensorEvent } from "@webos/shared";
import { SensorBadge } from "./badge.js";
import { SensorSender } from "./sender.js";
import { StreamController } from "./stream-controller.js";
import { InjectRelay } from "./inject-relay.js";

function ensureDataset(key: string): string {
  const root = document.documentElement;
  const existing = root?.dataset[key];
  if (existing) return existing;
  const value = crypto.randomUUID();
  if (root) root.dataset[key] = value;
  return value;
}

const nonce = ensureDataset("webosNonce");
const pageSessionId = ensureDataset("webosPageSession");
const badge = new SensorBadge();
badge.mount();

const rawFrames = new RingBuffer<RawFrame>(LIMITS.rawMaxFrames, LIMITS.rawMaxChars, (frame) => frame.text.length);
const controllers = new Map<string, StreamController>();
const sender = new SensorSender(pageSessionId, () => badge.setOffline());
const relay = new InjectRelay({ nonce });
let installed = false;

function isOurMessage(message: MainToBridgeMessage): boolean {
  if (message.pageSessionId !== pageSessionId) return false;
  switch (message.kind) {
    case "webos/sensor.ready":
      return true;
    case "webos/sensor.start":
      return (
        typeof message.requestId === "string" &&
        (message.transport === "xhr" || message.transport === "fetch") &&
        typeof message.endpoint === "string" &&
        typeof message.thinkingEnabled === "boolean" &&
        typeof message.ts === "number" &&
        (message.injectionVersion === undefined || typeof message.injectionVersion === "number")
      );
    case "webos/sensor.chunk":
      return typeof message.requestId === "string" && typeof message.chunk === "string";
    case "webos/sensor.end":
      return (
        typeof message.requestId === "string" &&
        (message.reason === "aborted" || message.reason === "transport-closed" || message.reason === "error")
      );
    case "webos/sensor.tap-error":
      return typeof message.code === "string" && typeof message.message === "string" && typeof message.fatal === "boolean";
    default:
      return false;
  }
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== location.origin) return;
  if (!isMainEnvelope(event.data) || event.data.nonce !== nonce) return;

  const message = event.data.message as MainToBridgeMessage;
  if (!isOurMessage(message)) return;

  switch (message.kind) {
    case "webos/sensor.ready": {
      installed = true;
      badge.setOnline(controllers.size);
      relay.rearm();
      return;
    }
    case "webos/sensor.start": {
      if (!installed) installed = true;
      if (message.injectionVersion !== undefined) relay.ack(message.injectionVersion);
      if (controllers.has(message.requestId)) return;
      if (controllers.size >= LIMITS.maxConcurrentStreams) {
        sender.enqueue({
          type: "sensor.error",
          requestId: message.requestId,
          code: "bridge-rejected",
          message: "Too many concurrent completion streams",
          fatal: true,
        });
        return;
      }
      const controller = new StreamController(
        message.requestId,
        message.thinkingEnabled,
        (sensorEvent) => sender.enqueue(sensorEvent),
        (frame) => rawFrames.push(frame),
      );
      controllers.set(message.requestId, controller);
      sender.enqueue({
        type: "sensor.stream.start",
        requestId: message.requestId,
        ts: message.ts,
        transport: message.transport,
        endpoint: message.endpoint,
        thinkingEnabled: message.thinkingEnabled,
      });
      badge.setStreams(controllers.size);
      return;
    }
    case "webos/sensor.chunk": {
      controllers.get(message.requestId)?.push(message.chunk);
      return;
    }
    case "webos/sensor.end": {
      const controller = controllers.get(message.requestId);
      if (!controller) return;
      controller.end(message.reason);
      controllers.delete(message.requestId);
      badge.setStreams(controllers.size);
      return;
    }
    case "webos/sensor.tap-error": {
      const sensorEvent: SensorEvent = {
        type: "sensor.error",
        code: message.code,
        message: message.message,
        fatal: message.fatal,
      };
      if (message.requestId !== undefined) sensorEvent.requestId = message.requestId;
      sender.enqueue(sensorEvent);
      return;
    }
  }
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const kind = (message as { kind?: string } | null)?.kind;

  if (kind === "webos/capture.dump") {
    const dump: BridgeDump = {
      v: 1,
      pageSessionId,
      frames: __DEV__ ? rawFrames.toArray() : [],
    };
    sendResponse({ kind: "webos/capture.dump.result", dump });
    return false;
  }

  if (kind === "webos/inject.arm") {
    const arm = message as { pageSessionId?: string; context?: unknown };
    if (arm.pageSessionId !== pageSessionId) return false;
    if (!isSystemContext(arm.context)) return false;
    relay.arm(arm.context);
    return false;
  }

  if (kind === "webos/inject.disarm") {
    const disarm = message as { pageSessionId?: string; target?: unknown };
    if (disarm.pageSessionId !== pageSessionId) return false;
    if (disarm.target !== "persona" && disarm.target !== "memory" && disarm.target !== "all") return false;
    relay.disarm(disarm.target);
    return false;
  }

  return false;
});

window.addEventListener("pagehide", () => sender.flush());
