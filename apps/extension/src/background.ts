import {
  CHANNELS,
  LIMITS,
  MAX_MEMORY_INJECT_CHARS,
  artifactSignature,
  buildAnswerText,
  buildTranscript,
  extractArtifacts,
  extractPageActions,
  formatFeedbackForContext,
  isSensorBatch,
  isSensorEvent,
  isTurnSettled,
  normalizeArtifactFeedback,
  selectAutoRenderArtifact,
} from "@webos/shared";
import type {
  ArtifactsResponse,
  CaptureDumpResponse,
  ContentMessage,
  ContentResponse,
  MemoryTranscriptResponse,
  RuntimeMessage,
  SensorBatch,
  SensorEvent,
  UiMessage,
  UiSessionSnapshot,
} from "@webos/shared";
import { RouterHost, readRouterEnabled, writeRouterEnabled } from "./router-host.js";
import { PageActHost } from "./pageact-host.js";

interface TabState {
  tabId: number;
  pageSessionId: string;
  events: SensorEvent[];
  chars: number;
  updatedAt: number;
  /** Rendered-artifact interactions (`webos.report`), oldest first, bounded. */
  artifactFeedback: string[];
  /**
   * Signature of the artifact last pushed to the canvas for this tab.
   * Dedupe guard: a settled turn pushes at most once per distinct artifact,
   * even if the end event is re-delivered or the SW restarts mid-session.
   */
  artifactPushSignature: string | null;
  /**
   * Signature of the page-action batch last run for this tab. Same dedupe
   * rationale as the artifact push: a settled turn runs each distinct
   * ```pageact block exactly once.
   */
  pageActRunSignature: string | null;
}

/** Keep only the most recent artifact interactions per tab. */
const MAX_ARTIFACT_FEEDBACK_ENTRIES = 8;

const tabs = new Map<number, TabState>();
const ports = new Set<chrome.runtime.Port>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let captureEnabled = false;

const routerHost = new RouterHost({
  sendArm: (tabId, pageSessionId, context) => {
    const message: ContentMessage = { kind: "webos/inject.arm", v: 1, pageSessionId, context };
    chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
  },
  sendDisarm: (tabId, pageSessionId) => {
    const message: ContentMessage = { kind: "webos/inject.disarm", v: 1, pageSessionId, target: "persona" };
    chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
  },
});

void readRouterEnabled().then((enabled) => routerHost.setEnabled(enabled));

function writeCapture(enabled: boolean): void {
  captureEnabled = enabled;
  void chrome.storage.local.set({ [CHANNELS.memoryCaptureStorageKey]: enabled }).catch(() => undefined);
}

function readCapture(): Promise<boolean> {
  return chrome.storage.local
    .get(CHANNELS.memoryCaptureStorageKey)
    .then((stored) => {
      const value = stored[CHANNELS.memoryCaptureStorageKey];
      return typeof value === "boolean" ? value : false;
    })
    .catch(() => false);
}

void readCapture().then((enabled) => {
  captureEnabled = enabled;
});

function eventWeight(event: SensorEvent): number {
  if (event.type === "sensor.text.delta") return event.text.length;
  if (event.type === "sensor.user.prompt") return event.text.length;
  return 1;
}

function isAllowedUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.hostname === "chat.deepseek.com") return true;
    return __DEV__ && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function snapshot(events: SensorEvent[]): SensorEvent[] {
  return events.slice(-1000);
}

function broadcast(message: UiMessage): void {
  for (const port of ports) {
    try {
      port.postMessage(message);
    } catch {
      ports.delete(port);
    }
  }
}

/**
 * PageAct host.
 *
 * `hasPanel` is what makes "nobody is listening" a refusal rather than a
 * hang: with no side panel open there is nobody who could approve a
 * dangerous action, so the worker must not wait for an answer that cannot
 * come.
 */
const pageActHost = new PageActHost({
  broadcast: (message) => broadcast(message),
  hasPanel: () => ports.size > 0,
});

function sendSnapshot(port: chrome.runtime.Port): void {
  const sessions: UiSessionSnapshot[] = [...tabs.values()].map((state) => ({
    tabId: state.tabId,
    pageSessionId: state.pageSessionId,
    events: snapshot(state.events),
    updatedAt: state.updatedAt,
  }));
  try {
    port.postMessage({ kind: "webos/ui.snapshot", sessions } satisfies UiMessage);
  } catch {
    ports.delete(port);
  }
}

function broadcastSnapshot(): void {
  for (const port of ports) sendSnapshot(port);
}

/**
 * Push the turn's renderable artifact to every connected side panel (canvas
 * auto-render). Called once per settled turn; the signature guard makes
 * re-delivery of the same end event a no-op.
 *
 * Push, not poll: `sensor.stream.end` only exists here in the service worker,
 * so this is the one place that knows a turn actually finished. A polling
 * side panel would have to guess, and would re-run buildAnswerText on a timer.
 */
function maybePushArtifacts(state: TabState): void {
  const answerText = buildAnswerText(state.events, "latest");
  const artifacts = extractArtifacts(answerText);
  const pick = selectAutoRenderArtifact(artifacts);
  if (!pick) return;
  const signature = artifactSignature(pick);
  if (state.artifactPushSignature === signature) return;
  state.artifactPushSignature = signature;
  broadcast({
    kind: "webos/ui.artifacts",
    tabId: state.tabId,
    pageSessionId: state.pageSessionId,
    artifacts,
    answerChars: answerText.length,
  });
}

/**
 * Model-proposed page actions: a ```pageact block in the answer is not an
 * artifact, it is an instruction. Extract every such block and run it through
 * the host — the same host the manual console uses, so the domain allowlist,
 * the validation, and the danger confirmation are all shared. Dedupe by
 * signature so a re-delivered end event cannot run the batch twice.
 */
function maybeRunPageActions(state: TabState): void {
  const answerText = buildAnswerText(state.events, "latest");
  const requests = extractPageActions(answerText);
  if (requests.length === 0) return;
  const signature = JSON.stringify(requests.map((request) => JSON.stringify(request.actions)));
  if (state.pageActRunSignature === signature) return;
  state.pageActRunSignature = signature;
  for (const request of requests) {
    void pageActHost.run(state.tabId, request.actions).then((outcome) => {
      broadcast({
        kind: "webos/ui.pageact.result",
        tabId: state.tabId,
        actions: request.actions,
        outcome,
      });
    });
  }
}

function ingest(tabId: number, batch: SensorBatch): void {
  let state = tabs.get(tabId);
  if (!state || state.pageSessionId !== batch.pageSessionId) {
    state = {
      tabId,
      pageSessionId: batch.pageSessionId,
      events: [],
      chars: 0,
      updatedAt: Date.now(),
      artifactFeedback: [],
      artifactPushSignature: null,
      pageActRunSignature: null,
    };
    tabs.set(tabId, state);
  }

  for (const event of batch.events) {
    state.events.push(event);
    state.chars += eventWeight(event);
    routerHost.onSensorEvent(event, tabId, batch.pageSessionId);
    if (isTurnSettled(event)) {
      maybePushArtifacts(state);
      maybeRunPageActions(state);
    }
  }
  state.updatedAt = Date.now();

  while (state.events.length > LIMITS.ringMaxEvents || state.chars > LIMITS.ringMaxChars) {
    const removed = state.events.shift();
    if (!removed) break;
    state.chars -= eventWeight(removed);
  }

  broadcast({ kind: "webos/ui.batch", tabId, batch });
  schedulePersist();
}

function schedulePersist(): void {
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistNow();
  }, 500);
}

async function persistNow(): Promise<void> {
  const payload = [...tabs.values()].map((state) => ({
    tabId: state.tabId,
    pageSessionId: state.pageSessionId,
    events: snapshot(state.events),
    updatedAt: state.updatedAt,
  }));
  try {
    await chrome.storage.session.set({ [CHANNELS.storageKey]: payload });
  } catch {
    // storage.session is best-effort; never fail the stream because of it.
  }
}

async function restore(): Promise<void> {
  try {
    const stored = await chrome.storage.session.get(CHANNELS.storageKey);
    const value = stored[CHANNELS.storageKey];
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as Record<string, unknown>;
      if (typeof record.tabId !== "number" || typeof record.pageSessionId !== "string") continue;
      if (!Array.isArray(record.events)) continue;
      const events = record.events.filter(isSensorEvent);
      tabs.set(record.tabId, {
        tabId: record.tabId,
        pageSessionId: record.pageSessionId,
        events,
        chars: events.reduce((sum, event) => sum + eventWeight(event), 0),
        updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
        // Artifact interactions are session-scoped: never restored from
        // storage, so a stale interaction cannot leak into a later session.
        artifactFeedback: [],
        // Same: start with no push signature, so the first settled turn after
        // a restore pushes once (the canvas's own dedupe makes it free).
        artifactPushSignature: null,
        pageActRunSignature: null,
      });
    }
    broadcastSnapshot();
  } catch {
    // ignore
  }
}

function clearAll(): void {
  tabs.clear();
  broadcast({ kind: "webos/ui.snapshot", sessions: [] });
  void chrome.storage.session.remove(CHANNELS.storageKey).catch(() => undefined);
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  void restore();
});

void restore();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== CHANNELS.uiPort) return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener((message: unknown) => {
    const kind = (message as { kind?: string } | null)?.kind;
    if (kind === "webos/ui.hello") sendSnapshot(port);
    else if (kind === "webos/ui.clear") clearAll();
  });
  sendSnapshot(port);
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const msg = message as RuntimeMessage;
  if (!msg || typeof msg !== "object") return false;

  if (msg.kind === "webos/sensor.batch") {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return false;
    if (!isAllowedUrl(sender.url ?? sender.tab?.url)) return false;
    if (!isSensorBatch(msg.batch)) return false;
    ingest(tabId, msg.batch);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.kind === "webos/capture.dump.request") {
    if (!Number.isInteger(msg.tabId)) {
      sendResponse({ kind: "webos/capture.dump.result", dump: null, error: "bad tab id" } satisfies CaptureDumpResponse);
      return false;
    }

    void chrome.tabs
      .get(msg.tabId)
      .then((tab) => {
        if (!isAllowedUrl(tab.url)) {
          sendResponse({
            kind: "webos/capture.dump.result",
            dump: null,
            error: "tab is not a supported chat page",
          } satisfies CaptureDumpResponse);
          return;
        }
        try {
          chrome.tabs.sendMessage(
            msg.tabId,
            { kind: "webos/capture.dump" } satisfies ContentMessage,
            (response: ContentResponse | undefined) => {
              const error = chrome.runtime.lastError;
              if (error || !response) {
                sendResponse({
                  kind: "webos/capture.dump.result",
                  dump: null,
                  error: error?.message ?? "content bridge did not respond",
                } satisfies CaptureDumpResponse);
                return;
              }
              sendResponse(response);
            },
          );
        } catch (error) {
          sendResponse({
            kind: "webos/capture.dump.result",
            dump: null,
            error: error instanceof Error ? error.message : String(error),
          } satisfies CaptureDumpResponse);
        }
      })
      .catch((error: unknown) => {
        sendResponse({
          kind: "webos/capture.dump.result",
          dump: null,
          error: error instanceof Error ? error.message : String(error),
        } satisfies CaptureDumpResponse);
      });

    return true;
  }

  if (msg.kind === "webos/ui.clear") {
    clearAll();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.kind === "webos/router.set-enabled") {
    routerHost.setEnabled(msg.enabled === true);
    void writeRouterEnabled(msg.enabled === true);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.kind === "webos/router.get-enabled") {
    sendResponse({ enabled: routerHost.isEnabled });
    return false;
  }

  if (msg.kind === "webos/memory.arm") {
    if (!Number.isInteger(msg.tabId)) {
      sendResponse({ ok: false, error: "bad tab id" });
      return false;
    }
    if (typeof msg.text !== "string" || msg.text.length === 0 || msg.text.length > MAX_MEMORY_INJECT_CHARS) {
      sendResponse({ ok: false, error: "memory text invalid or too long" });
      return false;
    }
    const state = tabs.get(msg.tabId);
    if (!state) {
      sendResponse({ ok: false, error: "unknown tab" });
      return false;
    }
    // Merge pending artifact interactions so the next turn can see what the
    // user did with the components it generated.
    const feedback = state.artifactFeedback.join("\n");
    const message: ContentMessage = {
      kind: "webos/inject.arm",
      v: 1,
      pageSessionId: state.pageSessionId,
      context: { memory: msg.text, ...(feedback ? { artifactFeedback: feedback } : {}) },
    };
    chrome.tabs.sendMessage(msg.tabId, message).catch(() => undefined);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.kind === "webos/memory.disarm") {
    if (!Number.isInteger(msg.tabId)) {
      sendResponse({ ok: false, error: "bad tab id" });
      return false;
    }
    const state = tabs.get(msg.tabId);
    if (!state) {
      sendResponse({ ok: false, error: "unknown tab" });
      return false;
    }
    const message: ContentMessage = {
      kind: "webos/inject.disarm",
      v: 1,
      pageSessionId: state.pageSessionId,
      target: "memory",
    };
    chrome.tabs.sendMessage(msg.tabId, message).catch(() => undefined);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.kind === "webos/memory.capture.set") {
    if (!Number.isInteger(msg.tabId) || typeof msg.enabled !== "boolean") {
      sendResponse({ ok: false, error: "bad args" });
      return false;
    }
    writeCapture(msg.enabled);
    const message: ContentMessage = { kind: "webos/memory.set-capture", v: 1, enabled: msg.enabled };
    chrome.tabs.sendMessage(msg.tabId, message).catch(() => undefined);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.kind === "webos/memory.capture.get") {
    sendResponse({ enabled: captureEnabled });
    return false;
  }

  if (msg.kind === "webos/memory.clear-captured") {
    if (!Number.isInteger(msg.tabId)) {
      sendResponse({ ok: false, error: "bad tab id" });
      return false;
    }
    const state = tabs.get(msg.tabId);
    if (state) {
      // Drop the whole captured ring for this tab so the transcript is empty.
      state.events = [];
      state.chars = 0;
      state.updatedAt = Date.now();
      state.artifactFeedback = [];
      // Clear any pending memory injection for the next turn.
      const disarmMessage: ContentMessage = {
        kind: "webos/inject.disarm",
        v: 1,
        pageSessionId: state.pageSessionId,
        target: "memory",
      };
      chrome.tabs.sendMessage(msg.tabId, disarmMessage).catch(() => undefined);
      // Stop capturing user prompts for this tab.
      const stopCapture: ContentMessage = { kind: "webos/memory.set-capture", v: 1, enabled: false };
      chrome.tabs.sendMessage(msg.tabId, stopCapture).catch(() => undefined);
    }
    writeCapture(false);
    broadcastSnapshot();
    schedulePersist();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.kind === "webos/memory.transcript.request") {
    const empty: MemoryTranscriptResponse = {
      kind: "webos/memory.transcript.result",
      transcript: "",
      turns: 0,
      chars: 0,
      hasUserPrompts: false,
      pageSessionId: "",
    };
    if (!Number.isInteger(msg.tabId)) {
      sendResponse(empty);
      return false;
    }
    const state = tabs.get(msg.tabId);
    if (!state) {
      sendResponse(empty);
      return false;
    }
    const result = buildTranscript(state.events);
    sendResponse({
      kind: "webos/memory.transcript.result",
      transcript: result.transcript,
      turns: result.turns,
      chars: result.chars,
      hasUserPrompts: result.hasUserPrompts,
      pageSessionId: state.pageSessionId,
    } satisfies MemoryTranscriptResponse);
    return false;
  }

  if (msg.kind === "webos/artifacts.request") {
    const empty: ArtifactsResponse = {
      kind: "webos/artifacts.result",
      artifacts: [],
      answerChars: 0,
      pageSessionId: "",
    };
    if (!Number.isInteger(msg.tabId)) {
      sendResponse(empty);
      return false;
    }
    const state = tabs.get(msg.tabId);
    if (!state) {
      sendResponse(empty);
      return false;
    }
    const answerText = buildAnswerText(state.events, msg.scope ?? "latest");
    sendResponse({
      kind: "webos/artifacts.result",
      artifacts: extractArtifacts(answerText),
      answerChars: answerText.length,
      pageSessionId: state.pageSessionId,
    } satisfies ArtifactsResponse);
    return false;
  }

  // Relayed by the side panel from the artifact sandbox page: a rendered
  // component called `webos.report(...)`. Untrusted input — normalize first.
  if (msg.kind === "webos/artifact.feedback") {
    if (!Number.isInteger(msg.tabId)) {
      sendResponse({ ok: false, error: "bad tab id" });
      return false;
    }
    const feedback = normalizeArtifactFeedback(msg.feedback);
    if (!feedback) {
      sendResponse({ ok: false, error: "invalid feedback" });
      return false;
    }
    const state = tabs.get(msg.tabId);
    if (!state) {
      sendResponse({ ok: false, error: "unknown tab" });
      return false;
    }
    state.artifactFeedback.push(formatFeedbackForContext(feedback));
    if (state.artifactFeedback.length > MAX_ARTIFACT_FEEDBACK_ENTRIES) {
      state.artifactFeedback = state.artifactFeedback.slice(-MAX_ARTIFACT_FEEDBACK_ENTRIES);
    }
    state.updatedAt = Date.now();
    broadcastSnapshot();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.kind === "webos/artifact.feedback.get") {
    const state = Number.isInteger(msg.tabId) ? tabs.get(msg.tabId) : undefined;
    sendResponse({ feedback: state ? [...state.artifactFeedback] : [] });
    return false;
  }

  // --- PageAct -------------------------------------------------------
  // The content script hit a dangerous action and needs a human decision.
  // The channel stays open while the user thinks: `return true` keeps it
  // alive, and the answer travels back on the same channel.
  if (msg.kind === "webos/pageact.confirm.request") {
    void pageActHost.requestConfirmation(msg.request).then((outcome) => {
      sendResponse({ approved: outcome.approved, outcome: outcome.outcome });
    });
    return true;
  }

  // The side panel relayed the user's answer.
  if (msg.kind === "webos/pageact.confirm.response") {
    sendResponse({ ok: pageActHost.answer({ id: msg.id, approved: msg.approved }) });
    return false;
  }

  // Run a batch of actions in a tab. The response is asynchronous — the
  // batch may pause for a confirmation — so the channel stays open too.
  if (msg.kind === "webos/pageact.run") {
    void pageActHost.run(msg.tabId, msg.actions).then((outcome) => {
      sendResponse(outcome);
    });
    return true;
  }

  return false;
});
