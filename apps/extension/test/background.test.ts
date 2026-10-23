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
/** Messages broadcast over the ui port (canvas pushes + snapshots). */
let portMessages: Array<Record<string, unknown>>;
let capturedConnectListener: ((port: unknown) => void) | undefined;
/** Connected fake ports, so afterEach can disconnect them like a real panel. */
const connectedPorts: Array<{ disconnect: () => void }> = [];

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
  portMessages = [];

  let capturedListener: MessageHandler | undefined;

  const chromeMock = {
    runtime: {
      onInstalled: { addListener: () => undefined },
      onStartup: { addListener: () => undefined },
      onConnect: {
        addListener: (fn: (port: unknown) => void) => {
          capturedConnectListener = fn;
        },
      },
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
  portMessages.length = 0;
  // Ports must be disconnected between tests: the service worker keeps every
  // connected port in a Set and broadcasts to all of them, so a leaked port
  // multiplies every later assertion.
  for (const port of connectedPorts) port.disconnect();
  connectedPorts.length = 0;
  for (const key of Object.keys(storageLocal)) delete storageLocal[key];
  for (const key of Object.keys(storageSession)) delete storageSession[key];
});

/** Connect a fake side panel port; broadcasts land in `portMessages`. */
function connectPort(): void {
  let onDisconnect: (() => void) | undefined;
  const port = {
    name: "webos:ui",
    postMessage: (message: unknown) => {
      portMessages.push(message as Record<string, unknown>);
    },
    onDisconnect: {
      addListener: (fn: () => void) => {
        onDisconnect = fn;
      },
    },
    onMessage: { addListener: () => undefined },
  };
  connectedPorts.push({ disconnect: () => onDisconnect?.() });
  capturedConnectListener?.(port);
}

function pushedArtifacts(): Array<Record<string, unknown>> {
  return portMessages.filter((m) => m.kind === "webos/ui.artifacts");
}

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

describe("background artifacts.request", () => {
  function ingestAnswer(text: string, requestId = "r1", pageSessionId = "session-artifacts"): void {
    const batch: SensorBatch = {
      v: 1,
      pageSessionId,
      seq: 1,
      events: [
        { type: "sensor.user.prompt", requestId, text: "写个页面", ts: 0 },
        { type: "sensor.text.delta", requestId, channel: "answer", text },
      ],
    };
    expect(dispatch({ kind: "webos/sensor.batch", batch })).toEqual({ ok: true });
  }

  it("extracts artifacts from the captured answer stream", () => {
    ingestAnswer('好的：\n```html\n<div>hi</div>\n```\n');

    const response = dispatch({ kind: "webos/artifacts.request", tabId: TAB_ID }) as {
      kind: string;
      artifacts: Array<{ language: string; code: string; kind: string }>;
      answerChars: number;
    };
    expect(response.kind).toBe("webos/artifacts.result");
    expect(response.answerChars).toBeGreaterThan(0);
    expect(response.artifacts).toHaveLength(1);
    expect(response.artifacts[0]).toMatchObject({ language: "html", code: "<div>hi</div>", kind: "render" });
  });

  it("defaults to the latest turn, and scope all returns every turn", () => {
    ingestAnswer('```html\n<div>first</div>\n```\n', "r1", "session-scope");
    ingestAnswer('```html\n<div>second</div>\n```\n', "r2", "session-scope");

    const latest = dispatch({ kind: "webos/artifacts.request", tabId: TAB_ID }) as {
      artifacts: Array<{ code: string }>;
    };
    expect(latest.artifacts).toHaveLength(1);
    expect(latest.artifacts[0]?.code).toBe("<div>second</div>");

    const all = dispatch({ kind: "webos/artifacts.request", tabId: TAB_ID, scope: "all" }) as {
      artifacts: Array<{ code: string }>;
    };
    expect(all.artifacts).toHaveLength(2);
    expect(all.artifacts[0]?.code).toBe("<div>first</div>");
  });

  it("returns empty artifacts for a bad tab id", () => {
    expect(dispatch({ kind: "webos/artifacts.request", tabId: "nope" })).toMatchObject({
      kind: "webos/artifacts.result",
      artifacts: [],
      answerChars: 0,
    });
  });

  it("returns empty artifacts for an unknown tab", () => {
    expect(dispatch({ kind: "webos/artifacts.request", tabId: 99999 })).toMatchObject({
      kind: "webos/artifacts.result",
      artifacts: [],
      answerChars: 0,
    });
  });
});

describe("background canvas auto-render push", () => {
  /** One settled turn: prompt → answer delta → stream end. */
  function ingestSettledTurn(
    answer: string,
    options: { requestId?: string; reason?: "finished" | "incomplete" | "aborted" | "error"; session?: string } = {},
  ): void {
    const requestId = options.requestId ?? "r1";
    const batch: SensorBatch = {
      v: 1,
      pageSessionId: options.session ?? "session-push",
      seq: 1,
      events: [
        { type: "sensor.user.prompt", requestId, text: "写个页面", ts: 0 },
        { type: "sensor.text.delta", requestId, channel: "answer", text: answer },
        { type: "sensor.stream.end", requestId, reason: options.reason ?? "finished", ts: 2 },
      ],
    };
    expect(dispatch({ kind: "webos/sensor.batch", batch })).toEqual({ ok: true });
  }

  it("pushes the turn's artifact to connected side panels once the turn settles", () => {
    connectPort();
    ingestSettledTurn('好的：\n```html\n<div>hi</div>\n```\n', { session: "session-push-1" });

    const pushes = pushedArtifacts();
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      kind: "webos/ui.artifacts",
      tabId: TAB_ID,
      pageSessionId: "session-push-1",
    });
    const artifacts = pushes[0]?.artifacts as Array<{ language: string; code: string }>;
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ language: "html", code: "<div>hi</div>" });
  });

  it("does not push for a code-only answer", () => {
    connectPort();
    ingestSettledTurn("```python\nprint(1)\n```\n", { session: "session-push-2" });
    expect(pushedArtifacts()).toHaveLength(0);
  });

  it("does not push when the stream was aborted", () => {
    connectPort();
    ingestSettledTurn('```html\n<div>x</div>\n```\n', { reason: "aborted", session: "session-push-3" });
    expect(pushedArtifacts()).toHaveLength(0);
  });

  it("pushes once per distinct artifact, even if the end event repeats", () => {
    connectPort();
    ingestSettledTurn('```html\n<div>same</div>\n```\n', { requestId: "r1", session: "session-push-4" });
    ingestSettledTurn('```html\n<div>same</div>\n```\n', { requestId: "r1", session: "session-push-4" });
    expect(pushedArtifacts()).toHaveLength(1);
  });

  it("pushes again when the next turn produces a different artifact", () => {
    connectPort();
    ingestSettledTurn('```html\n<div>one</div>\n```\n', { requestId: "r1", session: "session-push-5" });
    ingestSettledTurn('```html\n<div>two</div>\n```\n', { requestId: "r2", session: "session-push-5" });
    const pushes = pushedArtifacts();
    expect(pushes).toHaveLength(2);
    const second = pushes[1]?.artifacts as Array<{ code: string }>;
    expect(second[0]?.code).toBe("<div>two</div>");
  });

  it("pushes an incomplete stream too — partial artifacts beat an empty canvas", () => {
    connectPort();
    ingestSettledTurn('```html\n<div>partial</div>\n```\n', { reason: "incomplete", session: "session-push-6" });
    expect(pushedArtifacts()).toHaveLength(1);
  });
});
