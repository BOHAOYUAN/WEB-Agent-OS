import { ACTOR_PROTOCOL_VERSION, CHANNELS } from "@webos/shared";
import type { ActorResult, ArtifactFeedback, ArtifactsResponse, ArtifactScope, CaptureDumpResponse, MemorySource, MemorySummary, MemoryTranscriptResponse, UiMessage } from "@webos/shared";
import { mountArtifactCanvas, mountArtifactPanel, mountDebugPanel, mountPageActPanel, setArtifactRuntime } from "@webos/ui";
import type { ArtifactsLoadResult, ArtifactCanvas, PageActPanel, PageActRunOutcome } from "@webos/ui";
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
/** Canvas view component; assigned below, read by the port dispatcher. */
let canvas: ArtifactCanvas | null = null;
/** PageAct console + confirmation card; assigned below, read by the dispatcher. */
let pageActPanel: PageActPanel | null = null;

function connect(): void {
  try {
    const next = chrome.runtime.connect({ name: "webos:ui" });
    port = next;
    next.onMessage.addListener((message: unknown) => {
      const msg = message as UiMessage;
      // Auto-render pushes go to the canvas; everything else is debug-panel
      // traffic. Split here rather than inside the panel: the panel has no
      // business knowing about artifact kinds.
      if (msg.kind === "webos/ui.artifacts") {
        canvas?.ingestTurn(msg.artifacts);
        return;
      }
      // A dangerous action is waiting for the user's decision.
      if (msg.kind === "webos/ui.pageact.confirm") {
        pageActPanel?.showConfirm(msg.request);
        return;
      }
      // A model-proposed batch finished — show it in the console.
      if (msg.kind === "webos/ui.pageact.result") {
        pageActPanel?.showRunResult(msg.outcome);
        return;
      }
      panel.apply(msg);
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
// in local extension storage so an autostarted Actor can reconnect after a
// browser restart; it is loopback-only and never logged.

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
    tabId,
    pageSessionId: response.pageSessionId,
  };
}

async function loadArtifacts(scope: ArtifactScope): Promise<ArtifactsLoadResult> {
  const tabId = await getActiveTabId();
  const response = await sendRuntime<ArtifactsResponse>({ kind: "webos/artifacts.request", tabId, scope });
  if (response.kind !== "webos/artifacts.result") throw new Error("读取 Artifacts 失败");
  return {
    artifacts: response.artifacts,
    answerChars: response.answerChars,
    pageSessionId: response.pageSessionId,
    tabId,
  };
}

function requireActor(): ActorClient {
  if (!actor) throw new Error("未配置 token");
  return actor;
}

function saveMemory(memory: MemorySummary, model: string, source: MemorySource): Promise<ActorResult> {
  return requireActor().send({
    v: ACTOR_PROTOCOL_VERSION,
    id: nextCommandId(),
    kind: "memory-store",
    action: "save",
    memory,
    model,
    source,
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

/**
 * Full "清空记忆": clear the on-disk store (Actor) AND the local captured
 * transcript (ring buffer + pending injection + capture toggle). The local part
 * needs no Actor connection, so it runs first and is best-effort; the Actor
 * result is returned for the UI to display.
 */
async function clearAllMemory(): Promise<ActorResult> {
  const tabId = await getActiveTabId().catch(() => null);
  if (tabId !== null) {
    await sendRuntime({ kind: "webos/memory.clear-captured", tabId }).catch(() => undefined);
  }
  actorPanel?.setCaptureEnabled(false);
  return clearMemory();
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
  void chrome.storage.local.set({ [CHANNELS.actorTokenStorageKey]: token }).catch(() => undefined);
  if (actor) actor.connect();
}

/**
 * Export the Actor bridge's audit trail as a JSON file.
 *
 * The trail is redacted INSIDE the bridge (no token, no command line), so
 * what lands on disk is safe to hand to someone else — which is the point of
 * exporting it: a reviewer can read exactly what the bridge refused.
 */
async function exportAuditLog(): Promise<string> {
  if (!actor) throw new Error("未配置 token");
  const response = await actor.send({
    v: ACTOR_PROTOCOL_VERSION,
    id: nextCommandId(),
    kind: "audit-dump",
    timeoutMs: 10_000,
  });
  if (!response.ok) throw new Error(response.message);
  if (response.kind !== "audit-dump") throw new Error("意外的响应类型：" + response.kind);
  const payload = {
    exportedAt: new Date().toISOString(),
    records: response.records,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `webos-agent-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  anchor.click();
  // Revoke on the next tick: revoking synchronously can cancel the download
  // in some Chrome versions before it has started reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return `已导出 ${response.records.length} 条审计记录（${payload.exportedAt}）`;
}

async function initActorPanel(): Promise<void> {
  if (!actorRoot) return;
  let token = "";
  try {
    const stored = await chrome.storage.local.get(CHANNELS.actorTokenStorageKey);
    const value = stored[CHANNELS.actorTokenStorageKey];
    if (typeof value === "string") token = value;
    // Migration from the old session-only location.
    if (!token) {
      const session = await chrome.storage.session.get(CHANNELS.actorTokenStorageKey);
      const legacy = session[CHANNELS.actorTokenStorageKey];
      if (typeof legacy === "string") token = legacy;
    }
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
    onClearMemory: clearAllMemory,
    onInjectMemory: injectMemory,
    onExportAudit: exportAuditLog,
  });

  void sendRuntime<{ enabled?: boolean }>({ kind: "webos/memory.capture.get" })
    .then((state) => actorPanel?.setCaptureEnabled(state.enabled === true))
    .catch(() => undefined);

  if (token) {
    actor = new ActorClient({
      token,
      onStateChange: (state, detail) => actorPanel?.setState(state, detail),
    });
    actor.connect();
  }
}

void initActorPanel();

// --- PageAct console (run actions in the current tab) ---
const pageactRoot = document.getElementById("pageact-root");

if (pageactRoot) {
  pageActPanel = mountPageActPanel(pageactRoot, {
    onRun: async (actions) => {
      const tabId = await getActiveTabId();
      return sendRuntime<PageActRunOutcome>({ kind: "webos/pageact.run", tabId, actions });
    },
    onAnswer: async (id, approved) => {
      await sendRuntime({ kind: "webos/pageact.confirm.response", id, approved });
    },
  });
}

// --- View switching: console / canvas ---
type ViewName = "console" | "canvas";

const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".view-tab"));
const consoleView = document.getElementById("console-view");
const canvasView = document.getElementById("canvas-view");
const canvasDot = document.getElementById("canvas-dot");

/**
 * Run when the canvas becomes visible — e.g. to pull the latest artifact when
 * the panel was opened after the answer had already finished. Registered by the
 * canvas component, which owns what "refresh" means.
 */
const canvasActivators: Array<() => void> = [];

let activeView: ViewName = "console";

export function setView(name: ViewName): void {
  activeView = name;
  for (const button of viewButtons) {
    button.setAttribute("aria-selected", String(button.dataset.view === name));
  }
  // `hidden` toggled rather than elements removed: both views keep their
  // iframes alive, so switching back is instant and costs no re-render.
  consoleView?.toggleAttribute("hidden", name !== "console");
  canvasView?.toggleAttribute("hidden", name !== "canvas");
  if (name === "canvas") {
    canvasDot?.setAttribute("hidden", "");
    for (const activate of canvasActivators) activate();
  }
}

export function isCanvasVisible(): boolean {
  return activeView === "canvas";
}

for (const button of viewButtons) {
  button.addEventListener("click", () => {
    const name = button.dataset.view;
    if (name === "console" || name === "canvas") setView(name);
  });
}

// --- Artifacts panel (sandboxed code blocks) ---
const artifactRoot = document.getElementById("artifact-root");

/** Tab the artifact panels last loaded from; `webos.report()` relays back to it. */
let artifactTabId: number | undefined;

function relayArtifactFeedback(feedback: ArtifactFeedback): void {
  if (artifactTabId === undefined) return;
  void chrome.runtime
    .sendMessage({ kind: "webos/artifact.feedback", tabId: artifactTabId, feedback })
    .catch(() => undefined);
}

/**
 * Load artifacts for whichever artifact view asks. The list and the canvas
 * both need the same data, and the feedback relay targets the tab the panel
 * last loaded from — so the callback is shared rather than duplicated.
 */
function loadArtifactsForView(scope: ArtifactScope): Promise<ArtifactsLoadResult> {
  return loadArtifacts(scope).then((result) => {
    artifactTabId = result.tabId;
    return result;
  });
}

if (artifactRoot) {
  // Vendored React/Sucrase bundles, injected as strings: a srcdoc iframe has an
  // opaque origin and cannot load extension resources, so JSX artifacts inline
  // them instead. Generated by scripts/build-artifact-runtime.mjs.
  //
  // Dynamic import on purpose: it lets esbuild code-split the ~420 KB runtime
  // into its own chunk (see scripts/build.mjs), so the panel's main chunk stays
  // ~55 KB and the runtime downloads in parallel with the panel opening
  // instead of blocking it. The import is kicked off at startup, not on first
  // use, so in practice it always lands before the first JSX artifact — and if
  // it hasn't (or the chunk failed to load), JSX degrades to read-only code
  // ("JSX 运行时未加载"), which is a missing feature, not a security hole.
  void import("./generated/artifact-runtime.js")
    .then((runtime) => {
      setArtifactRuntime(runtime.REACT_RUNTIME_SOURCE, runtime.SUCRASE_RUNTIME_SOURCE);
    })
    .catch(() => undefined);

  mountArtifactPanel(artifactRoot, {
    onLoadArtifacts: loadArtifactsForView,
    // Identity is verified inside the sandbox frame, not here: that iframe has
    // an opaque origin, so `event.origin` is always "null" and an origin check
    // would silently drop every report. All this side does is relay.
    onFeedback: relayArtifactFeedback,
    onOpenInCanvas: (artifact) => {
      canvas?.openArtifact(artifact);
      setView("canvas");
    },
  });
}

// --- Canvas view (auto-rendered artifact stage) ---
const canvasRoot = document.getElementById("canvas-root");
if (canvasRoot) {
  const view = mountArtifactCanvas(canvasRoot, {
    isVisible: () => isCanvasVisible(),
    initialAutoRender: true,
    onLoadArtifacts: loadArtifactsForView,
    onFeedback: relayArtifactFeedback,
    onAutoRenderChange: (enabled) => {
      void chrome.storage.local.set({ [CHANNELS.canvasAutoRenderStorageKey]: enabled }).catch(() => undefined);
    },
    onPendingChange: (count) => {
      canvasDot?.toggleAttribute("hidden", count === 0);
    },
  });
  canvas = view;
  canvasActivators.push(() => canvas?.activate());

  // Restore the persisted toggle (default on). This path does not persist —
  // it IS the restore, writing back what we just read would be noise.
  // `view` (not `canvas`) is captured: the outer let is not narrowed inside
  // an async closure, and the view cannot disappear under us here anyway.
  void chrome.storage.local
    .get(CHANNELS.canvasAutoRenderStorageKey)
    .then((stored) => {
      const value = stored[CHANNELS.canvasAutoRenderStorageKey];
      if (typeof value === "boolean") view.setAutoRender(value);
    })
    .catch(() => undefined);
}
