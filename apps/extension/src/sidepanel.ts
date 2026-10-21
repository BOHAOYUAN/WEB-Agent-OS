import { ACTOR_PROTOCOL_VERSION, CHANNELS } from "@webos/shared";
import type { ActorResult, CaptureDumpResponse, MemorySummary, MemoryTranscriptResponse, UiMessage } from "@webos/shared";
import { mountDebugPanel } from "@webos/ui";
import { ActorClient, nextCommandId } from "./actor-client.js";
import { mountActorPanel, type ActorPanel } from "./actor-ui.js";
import type { TranscriptLoadResult } from "./actor-ui.js";

const root = document.getElementById("root");
if (!root) throw new Error("side panel root element is missing");

function sendRuntime<T>(message: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response: T) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

const panel = mountDebugPanel(root, {
  onDump: async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) return null;
      const response = await sendRuntime<CaptureDumpResponse>({ kind: "webos/capture.dump.request", tabId: tab.id });
      if (response.kind !== "webos/capture.dump.result" || !response.dump) return null;
      return response.dump;
    } catch {
      return null;
    }
  },
  onClear: () => {
    void sendRuntime({ kind: "webos/ui.clear" }).catch(() => undefined);
  },
  onToggleInject: (enabled) => {
    void sendRuntime({ kind: "webos/router.set-enabled", enabled }).catch(() => undefined);
  },
});

// Read the current injection flag from storage so the toggle reflects reality.
void sendRuntime<{ enabled?: boolean }>({ kind: "webos/router.get-enabled" })
  .then((state) => panel.setInjectEnabled(state.enabled === true))
  .catch(() => undefined);

let port: chrome.runtime.Port | null = null;

function connect(): void {
  try {
    const next = chrome.runtime.connect({ name: "webos:ui" });
    port = next;
    next.onMessage.addListener((message: unknown) => {
      panel.apply(message as UiMessage);
    });
    next.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connect, 500);
    });
    next.postMessage({ kind: "webos/ui.hello" });
  } catch {
    setTimeout(connect, 1000);
  }
}

connect();

window.addEventListener("unload", () => {
  try {
    port?.disconnect();
  } catch {
    // ignore
  }
});

// --- Actor bridge (local memory-summary) ---
// The WS client lives here, in the side panel — not the service worker —
// because the panel stays open for the whole interaction. The token is stored
// in session-scoped extension storage (browser restart clears it) and never logged.

const actorRoot = document.getElementById("actor-root");
let actor: ActorClient | null = null;
let actorPanel: ActorPanel | null = null;

function summarize(transcript: string): Promise<ActorResult> {
  if (!actor) return Promise.reject(new Error("未配置 token"));
  return actor.send({
    v: ACTOR_PROTOCOL_VERSION,
    id: nextCommandId(),
    kind: "memory-summary",
    transcript,
    timeoutMs: 30_000,
  });
}

async function getActiveTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error("找不到活动标签页");
  return tab.id;
}

async function loadTranscript(): Promise<TranscriptLoadResult> {
  const tabId = await getActiveTabId();
  const response = await sendRuntime<MemoryTranscriptResponse>({ kind: "webos/memory.transcript.request", tabId });
  if (response.kind !== "webos/memory.transcript.result") throw new Error("读取对话失败");
  return {
    transcript: response.transcript,
    turns: response.turns,
    chars: response.chars,
    hasUserPrompts: response.hasUserPrompts,
  };
}

function requireActor(): ActorClient {
  if (!actor) throw new Error("未配置 token");
  return actor;
}

function saveMemory(memory: MemorySummary, model: string): Promise<ActorResult> {
  return requireActor().send({
    v: ACTOR_PROTOCOL_VERSION,
    id: nextCommandId(),
    kind: "memory-store",
    action: "save",
    memory,
    model,
    timeoutMs: 10_000,
  });
}

function loadMemory(): Promise<ActorResult> {
  return requireActor().send({
    v: ACTOR_PROTOCOL_VERSION,
    id: nextCommandId(),
    kind: "memory-store",
    action: "get",
    timeoutMs: 10_000,
  });
}

function clearMemory(): Promise<ActorResult> {
  return requireActor().send({
    v: ACTOR_PROTOCOL_VERSION,
    id: nextCommandId(),
    kind: "memory-store",
    action: "clear",
    timeoutMs: 10_000,
  });
}

function injectMemory(text: string): void {
  void getActiveTabId()
    .then((tabId) => sendRuntime({ kind: "webos/memory.arm", tabId, text }))
    .catch(() => undefined);
}

function saveActorToken(token: string): void {
  actor?.disconnect();
  actor = token
    ? new ActorClient({
        token,
        onStateChange: (state, detail) => actorPanel?.setState(state, detail),
      })
    : null;
  void chrome.storage.session.set({ [CHANNELS.actorTokenStorageKey]: token }).catch(() => undefined);
}

async function initActorPanel(): Promise<void> {
  if (!actorRoot) return;
  let token = "";
  try {
    const stored = await chrome.storage.session.get(CHANNELS.actorTokenStorageKey);
    const value = stored[CHANNELS.actorTokenStorageKey];
    if (typeof value === "string") token = value;
  } catch {
    // ignore
  }

  actorPanel = mountActorPanel(actorRoot, {
    initialToken: token,
    extensionId: chrome.runtime.id,
    onSaveToken: saveActorToken,
    onConnect: () => actor?.connect(),
    onDisconnect: () => actor?.disconnect(),
    onSummarize: summarize,
    onToggleCapture: (enabled) => {
      void getActiveTabId()
        .then((tabId) => sendRuntime({ kind: "webos/memory.capture.set", tabId, enabled }))
        .catch(() => undefined);
    },
    onLoadTranscript: loadTranscript,
    onSaveMemory: saveMemory,
    onLoadMemory: loadMemory,
    onClearMemory: clearMemory,
    onInjectMemory: injectMemory,
  });

  void sendRuntime<{ enabled?: boolean }>({ kind: "webos/memory.capture.get" })
    .then((state) => actorPanel?.setCaptureEnabled(state.enabled === true))
    .catch(() => undefined);

  if (token) {
    actor = new ActorClient({
      token,
      onStateChange: (state, detail) => actorPanel?.setState(state, detail),
    });
  }
}

void initActorPanel();
