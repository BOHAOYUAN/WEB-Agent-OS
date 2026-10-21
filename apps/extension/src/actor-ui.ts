/**
 * Side-panel UI for the local Actor bridge (memory-summary + memory store).
 *
 * Pure DOM, no network I/O — the actual WS socket lives in actor-client.ts.
 * The panel is driven by callbacks; the connection state is pushed in from the
 * owning sidepanel.ts via `setState`.
 */

import { MAX_MEMORY_INJECT_CHARS, formatMemoryForPrompt } from "@webos/shared";
import type { ActorResult, MemorySource, MemorySummary } from "@webos/shared";
import type { ActorState } from "./actor-client.js";

export interface TranscriptLoadResult {
  transcript: string;
  turns: number;
  chars: number;
  hasUserPrompts: boolean;
  /** The tab the transcript was read from (for source provenance on save). */
  tabId: number;
  /** The page session id the transcript belongs to. */
  pageSessionId: string;
}

export interface ActorPanelOptions {
  initialToken: string;
  /** chrome.runtime.id — shown so the user can pass --allow-origin. */
  extensionId: string;
  captureEnabled?: boolean;
  onSaveToken: (token: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onSummarize: (transcript: string) => Promise<ActorResult>;
  onToggleCapture: (enabled: boolean) => void;
  onLoadTranscript: () => Promise<TranscriptLoadResult>;
  onSaveMemory: (memory: MemorySummary, model: string, source: MemorySource) => Promise<ActorResult>;
  onLoadMemory: () => Promise<ActorResult>;
  onClearMemory: () => Promise<ActorResult>;
  onInjectMemory: (text: string) => void;
}

export interface ActorPanel {
  setState(state: ActorState, detail: string): void;
  setToken(token: string): void;
  setCaptureEnabled(enabled: boolean): void;
  dispose(): void;
}

export function mountActorPanel(root: HTMLElement, options: ActorPanelOptions): ActorPanel {
  const card = document.createElement("section");
  card.className = "actor-card";

  const header = document.createElement("div");
  header.className = "actor-header";
  const titleBox = document.createElement("div");
  titleBox.className = "actor-titlebox";
  const title = document.createElement("div");
  title.className = "ws-title";
  title.textContent = "Actor 连接 · 本地记忆";
  const subtitle = document.createElement("div");
  subtitle.className = "ws-subtitle";
  subtitle.textContent = "侧边栏直连 127.0.0.1 的本地 Actor 进程（WS）";
  titleBox.append(title, subtitle);
  header.append(titleBox);

  const tokenRow = document.createElement("div");
  tokenRow.className = "actor-token-row";
  const tokenInput = document.createElement("input");
  tokenInput.className = "actor-token";
  tokenInput.type = "password";
  tokenInput.placeholder = "粘贴 Actor token（CLI 启动时打印）";
  tokenInput.value = options.initialToken;
  const saveButton = document.createElement("button");
  saveButton.className = "ws-button";
  saveButton.textContent = "保存 token";
  tokenRow.append(tokenInput, saveButton);

  const controls = document.createElement("div");
  controls.className = "actor-controls";
  const connectButton = document.createElement("button");
  connectButton.className = "ws-button";
  connectButton.textContent = "连接";
  const status = document.createElement("span");
  status.className = "actor-status";
  status.dataset.kind = "idle";
  status.textContent = "未连接";
  controls.append(connectButton, status);

  const originRow = document.createElement("div");
  originRow.className = "actor-origin";
  originRow.textContent = `extension id: ${options.extensionId} · 若连接被 403，请在 CLI 加 --allow-origin chrome-extension://${options.extensionId}`;

  const captureRow = document.createElement("label");
  captureRow.className = "actor-capture";
  const captureToggle = document.createElement("input");
  captureToggle.type = "checkbox";
  captureToggle.checked = options.captureEnabled ?? false;
  const captureNote = document.createElement("span");
  captureNote.className = "actor-capture-note";
  captureNote.textContent = "允许捕获用户提问（仅存本地 ring buffer，默认关，可清除）";
  captureRow.append(captureToggle, captureNote);

  const transcriptBox = document.createElement("div");
  transcriptBox.className = "actor-transcript";
  const transcriptLabel = document.createElement("div");
  transcriptLabel.className = "actor-label";
  transcriptLabel.textContent = "对话原文（transcript）";
  const transcriptArea = document.createElement("textarea");
  transcriptArea.className = "actor-textarea";
  transcriptArea.rows = 4;
  transcriptArea.placeholder = "用户：…\n助手：…";
  transcriptBox.append(transcriptLabel, transcriptArea);

  const transcriptActions = document.createElement("div");
  transcriptActions.className = "actor-transcript-actions";
  const loadButton = document.createElement("button");
  loadButton.className = "ws-button ws-button-ghost";
  loadButton.textContent = "读取当前对话";
  const transcriptStats = document.createElement("span");
  transcriptStats.className = "actor-stats";
  transcriptStats.textContent = "";
  transcriptActions.append(loadButton, transcriptStats);

  const summarizeButton = document.createElement("button");
  summarizeButton.className = "ws-button";
  summarizeButton.textContent = "总结当前对话";
  summarizeButton.disabled = true;

  const preview = document.createElement("div");
  preview.className = "actor-preview";
  preview.hidden = true;
  const previewLabel = document.createElement("div");
  previewLabel.className = "actor-label";
  previewLabel.textContent = "记忆预览（将注入下一轮）";
  const previewText = document.createElement("pre");
  previewText.className = "actor-result";
  const previewStats = document.createElement("div");
  previewStats.className = "actor-stats";
  preview.append(previewLabel, previewText, previewStats);

  const opsRow = document.createElement("div");
  opsRow.className = "actor-ops";
  const saveMemoryButton = document.createElement("button");
  saveMemoryButton.className = "ws-button";
  saveMemoryButton.textContent = "保存到记忆";
  const injectButton = document.createElement("button");
  injectButton.className = "ws-button";
  injectButton.textContent = "注入下一轮";
  const loadMemoryButton = document.createElement("button");
  loadMemoryButton.className = "ws-button ws-button-ghost";
  loadMemoryButton.textContent = "读取已保存记忆";
  const clearMemoryButton = document.createElement("button");
  clearMemoryButton.className = "ws-button ws-button-ghost";
  clearMemoryButton.textContent = "清空记忆";
  opsRow.append(saveMemoryButton, injectButton, loadMemoryButton, clearMemoryButton);

  const result = document.createElement("pre");
  result.className = "actor-result";
  result.textContent = "（尚未生成记忆）";

  card.append(
    header,
    tokenRow,
    controls,
    originRow,
    captureRow,
    transcriptBox,
    transcriptActions,
    summarizeButton,
    preview,
    opsRow,
    result,
  );
  root.replaceChildren(card);

  let connected = false;
  let disposed = false;
  let lastMemory: MemorySummary | null = null;
  let lastModel: string | null = null;
  let lastSource: MemorySource | null = null;

  const updatePreview = (): void => {
    if (!lastMemory) {
      preview.hidden = true;
      injectButton.disabled = true;
      saveMemoryButton.disabled = true;
      return;
    }
    const text = formatMemoryForPrompt(lastMemory);
    previewText.textContent = text;
    previewStats.textContent = `${text.length} / ${MAX_MEMORY_INJECT_CHARS} 字符`;
    preview.hidden = false;
    injectButton.disabled = false;
    saveMemoryButton.disabled = !connected;
  };

  const setState = (state: ActorState, detail: string): void => {
    connected = state === "connected";
    const label: Record<ActorState, string> = {
      disconnected: "未连接",
      connecting: "连接中…",
      connected: "已连接",
      error: "错误",
    };
    status.textContent = `${label[state]} · ${detail}`;
    status.dataset.kind = state === "connected" ? "ok" : state === "error" ? "warn" : "idle";
    connectButton.textContent = connected ? "断开" : "连接";
    summarizeButton.disabled = !connected;
    saveMemoryButton.disabled = !connected || !lastMemory;
    loadMemoryButton.disabled = !connected;
    clearMemoryButton.disabled = !connected;
  };

  saveButton.addEventListener("click", () => {
    options.onSaveToken(tokenInput.value.trim());
  });

  connectButton.addEventListener("click", () => {
    if (connected) options.onDisconnect();
    else options.onConnect();
  });

  captureToggle.addEventListener("change", () => {
    options.onToggleCapture(captureToggle.checked);
  });

  loadButton.addEventListener("click", () => {
    loadButton.disabled = true;
    transcriptStats.textContent = "读取中…";
    void options
      .onLoadTranscript()
      .then((loaded) => {
        transcriptArea.value = loaded.transcript;
        lastSource = { tabId: loaded.tabId, pageSessionId: loaded.pageSessionId, turnCount: loaded.turns };
        if (loaded.transcript.length === 0) {
          transcriptStats.textContent = "（没有可读取的对话，请先开启捕获并发送消息）";
        } else {
          transcriptStats.textContent = `${loaded.turns} 轮 · ${loaded.chars} 字符${loaded.hasUserPrompts ? "" : " · 无用户提问"}`;
        }
      })
      .catch((error: unknown) => {
        transcriptStats.textContent = "读取失败：" + (error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!disposed) loadButton.disabled = false;
      });
  });

  summarizeButton.addEventListener("click", () => {
    const transcript = transcriptArea.value.trim();
    if (!transcript) {
      result.textContent = "（请先输入对话原文）";
      return;
    }
    summarizeButton.disabled = true;
    result.textContent = "（正在调用本地模型…）";
    void options
      .onSummarize(transcript)
      .then((response) => {
        result.textContent = JSON.stringify(response, null, 2);
        if (response.ok && response.kind === "memory-summary") {
          lastMemory = response.memory;
          lastModel = response.model;
        } else {
          lastMemory = null;
          lastModel = null;
        }
        updatePreview();
      })
      .catch((error: unknown) => {
        result.textContent = "总结失败：" + (error instanceof Error ? error.message : String(error));
        lastMemory = null;
        lastModel = null;
        updatePreview();
      })
      .finally(() => {
        if (!disposed) summarizeButton.disabled = !connected;
      });
  });

  saveMemoryButton.addEventListener("click", () => {
    if (!lastMemory || !lastModel) return;
    saveMemoryButton.disabled = true;
    result.textContent = "（正在保存…）";
    void options
      .onSaveMemory(lastMemory, lastModel, lastSource ?? {})
      .then((response) => {
        result.textContent = JSON.stringify(response, null, 2);
      })
      .catch((error: unknown) => {
        result.textContent = "保存失败：" + (error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!disposed) saveMemoryButton.disabled = !connected || !lastMemory;
      });
  });

  injectButton.addEventListener("click", () => {
    if (!lastMemory) return;
    const text = formatMemoryForPrompt(lastMemory);
    options.onInjectMemory(text);
    result.textContent = "已注入下一轮（一次消费，下一轮请求生效；再次注入需重新点击）\n\n" + text;
  });

  loadMemoryButton.addEventListener("click", () => {
    loadMemoryButton.disabled = true;
    result.textContent = "（正在读取…）";
    void options
      .onLoadMemory()
      .then((response) => {
        result.textContent = JSON.stringify(response, null, 2);
      })
      .catch((error: unknown) => {
        result.textContent = "读取失败：" + (error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!disposed) loadMemoryButton.disabled = !connected;
      });
  });

  clearMemoryButton.addEventListener("click", () => {
    clearMemoryButton.disabled = true;
    result.textContent = "（正在清空…）";
    void options
      .onClearMemory()
      .then((response) => {
        result.textContent = JSON.stringify(response, null, 2);
      })
      .catch((error: unknown) => {
        result.textContent = "清空失败：" + (error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!disposed) clearMemoryButton.disabled = !connected;
      });
  });

  return {
    setState,
    setToken(token: string): void {
      tokenInput.value = token;
    },
    setCaptureEnabled(enabled: boolean): void {
      captureToggle.checked = enabled;
    },
    dispose(): void {
      disposed = true;
      root.replaceChildren();
    },
  };
}
