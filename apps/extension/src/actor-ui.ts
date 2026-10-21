/**
 * Side-panel UI for the local Actor bridge (memory-summary capability).
 *
 * Pure DOM, no network I/O — the actual WS socket lives in actor-client.ts.
 * The panel is driven by callbacks; the connection state is pushed in from the
 * owning sidepanel.ts via `setState`.
 */

import type { ActorResult } from "@webos/shared";
import type { ActorState } from "./actor-client.js";

export interface ActorPanelOptions {
  initialToken: string;
  /** chrome.runtime.id — shown so the user can pass --allow-origin. */
  extensionId: string;
  onSaveToken: (token: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onSummarize: (transcript: string) => Promise<ActorResult>;
}

export interface ActorPanel {
  setState(state: ActorState, detail: string): void;
  setToken(token: string): void;
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

  const summarizeButton = document.createElement("button");
  summarizeButton.className = "ws-button";
  summarizeButton.textContent = "总结当前对话";
  summarizeButton.disabled = true;

  const result = document.createElement("pre");
  result.className = "actor-result";
  result.textContent = "（尚未生成记忆）";

  card.append(header, tokenRow, controls, originRow, transcriptBox, summarizeButton, result);
  root.replaceChildren(card);

  let connected = false;
  let disposed = false;

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
  };

  saveButton.addEventListener("click", () => {
    options.onSaveToken(tokenInput.value.trim());
  });

  connectButton.addEventListener("click", () => {
    if (connected) options.onDisconnect();
    else options.onConnect();
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
      })
      .catch((error: unknown) => {
        result.textContent = "总结失败：" + (error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!disposed) summarizeButton.disabled = !connected;
      });
  });

  return {
    setState,
    setToken(token: string): void {
      tokenInput.value = token;
    },
    dispose(): void {
      disposed = true;
      root.replaceChildren();
    },
  };
}
