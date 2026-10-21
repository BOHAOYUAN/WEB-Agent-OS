import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SensorBatch } from "@webos/shared";

/**
 * Exercises the service-worker message handler for `webos/memory.clear-captured`
 * against a minimal chrome.* mock. The handler is registered at module load, so
 * `chrome` must be stubbed before the dynamic import below.
 */

const TAB_ID = 5;

type MessageHandler = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean | void;

let handleMessage: MessageHandler;
let storageLocal: Record<string, unknown>;
let storageSession: Record<string, unknown>;
let sentToContent: Array<{ tabId: number; message: Record<string, unknown> }>;

function makeStorageArea(store: Record<string, unknown>) {
  return {
    get(
      key: string | string[] | Record<string, unknown>,
      callback?: (result: Record<string, unknown>) => void,
    ): Promise<Record<string, unknown>> {
      let result: Record<string, unknown>;
      if (typeof key === "string") {
        result = store[key] !== undefined ? { [key]: store[key] } : {};
      } else if (Array.isArray(key)) {
        result = {};
        for (const k of key) if (store[k] !== undefined) result[k] = store[k];
      } else {
        result = { ...store };
      }
      if (callback) queueMicrotask(() => callback(result));
      return Promise.resolve(result);
    },
    set(items: Record<string, unknown>, callback?: () => void): Promise<void> {
      Object.assign(store, items);
      if (callback) queueMicrotask(callback);
      return Promise.resolve();
    },
    remove(key: string | string[], callback?: () => void): Promise<void> {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) delete store[k];
      if (callback) queueMicrotask(callback);
      return Promise.resolve();
    },
  };
}

beforeAll(async () => {
  storageLocal = {};
  storageSession = {};
  sentToContent = [];

  let capturedListener: MessageHandler | undefined;

  const chromeMock = {
    runtime: {
      onInstalled: { addListener: () => undefined },
      onStartup: { addListener: () => undefined },
      onConnect: { addListener: () => undefined },
      onMessage: {
        addListener: (fn: MessageHandler) => {
          capturedListener = fn;
        },
      },
    },
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    storage: {
      local: makeStorageArea(storageLocal),
      session: makeStorageArea(storageSession),
    },
    tabs: {
      sendMessage: (tabId: number, message: Record<string, unknown>) => {
        sentToContent.push({ tabId, message });
        return Promise.resolve();
      },
    },
  };

  vi.stubGlobal("chrome", chromeMock);

  await import("../src/background.js");

  if (!capturedListener) throw new Error("background did not register an onMessage listener");
  handleMessage = capturedListener;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  sentToContent.length = 0;
  for (const key of Object.keys(storageLocal)) delete storageLocal[key];
  for (const key of Object.keys(storageSession)) delete storageSession[key];
});

function dispatch(
  message: unknown,
  sender: unknown = { tab: { id: TAB_ID }, url: "https://chat.deepseek.com" },
): unknown {
  let response: unknown;
  handleMessage(message, sender, (r) => {
    response = r;
  });
  return response;
}

function ingestTurn(text: string, answer: string): void {
  const batch: SensorBatch = {
    v: 1,
    pageSessionId: "session-1",
    seq: 1,
    events: [
      { type: "sensor.user.prompt", requestId: "r1", text, ts: 0 },
      { type: "sensor.text.delta", requestId: "r1", channel: "answer", text: answer },
    ],
  };
  expect(dispatch({ kind: "webos/sensor.batch", batch })).toEqual({ ok: true });
}

describe("background memory clear-captured", () => {
  it("clears the captured transcript so transcript.request returns 0 turns", () => {
    ingestTurn("请帮我写一个 TypeScript 防抖函数", "好的，下面是代码示例……");

    const before = dispatch({ kind: "webos/memory.transcript.request", tabId: TAB_ID });
    expect((before as { turns: number }).turns).toBeGreaterThan(0);

    expect(dispatch({ kind: "webos/memory.clear-captured", tabId: TAB_ID })).toEqual({ ok: true });

    const after = dispatch({ kind: "webos/memory.transcript.request", tabId: TAB_ID });
    expect(after).toMatchObject({
      kind: "webos/memory.transcript.result",
      transcript: "",
      turns: 0,
      chars: 0,
      hasUserPrompts: false,
    });
  });

  it("rejects a clear-captured with a bad tab id", () => {
    expect(dispatch({ kind: "webos/memory.clear-captured", tabId: "nope" })).toEqual({
      ok: false,
      error: "bad tab id",
    });
  });

  it("disarms memory injection and stops capture for the tab", () => {
    ingestTurn("问题", "回答");
    dispatch({ kind: "webos/memory.clear-captured", tabId: TAB_ID });

    const disarm = sentToContent.find((m) => m.message.kind === "webos/inject.disarm");
    expect(disarm?.message).toMatchObject({ kind: "webos/inject.disarm", target: "memory" });

    const stopCapture = sentToContent.find((m) => m.message.kind === "webos/memory.set-capture");
    expect(stopCapture?.message).toMatchObject({ kind: "webos/memory.set-capture", enabled: false });
  });

  it("turns capture off so capture.get returns false after clear", () => {
    expect(dispatch({ kind: "webos/memory.capture.set", tabId: TAB_ID, enabled: true })).toEqual({ ok: true });
    expect(dispatch({ kind: "webos/memory.capture.get" })).toEqual({ enabled: true });

    dispatch({ kind: "webos/memory.clear-captured", tabId: TAB_ID });

    expect(dispatch({ kind: "webos/memory.capture.get" })).toEqual({ enabled: false });
  });
});
