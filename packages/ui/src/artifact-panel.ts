/**
 * Artifacts panel — pure DOM, no network, no credential access.
 *
 * Lists fenced code blocks extracted from the current tab's answer stream and
 * lets the user open html/svg artifacts in a sandboxed iframe. The sandbox and
 * CSP come from `renderArtifactSrcdoc` in shared — this panel does no safety
 * judgment of its own, it only assembles DOM and assigns `iframe.srcdoc`.
 *
 * Red lines enforced here:
 *  - code preview always uses `textContent` (never `innerHTML`);
 *  - the iframe is created only on explicit user click, never automatically.
 */

import type { Artifact } from "@webos/shared";
import { renderArtifactSrcdoc } from "@webos/shared";

export interface ArtifactsLoadResult {
  artifacts: Artifact[];
  answerChars: number;
  pageSessionId: string;
  tabId: number;
}

export interface ArtifactPanelOptions {
  onLoadArtifacts: () => Promise<ArtifactsLoadResult>;
}

export interface ArtifactPanel {
  dispose(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountArtifactPanel(root: HTMLElement, options: ArtifactPanelOptions): ArtifactPanel {
  const card = el("section", "actor-card");

  const header = el("div", "actor-header");
  const titleBox = el("div", "actor-titlebox");
  titleBox.append(
    el("div", "ws-title", "Artifacts · 沙箱"),
    el("div", "ws-subtitle", "模型输出的代码块，仅 html/svg 可渲染，其余只读展示"),
  );
  header.append(titleBox);

  const actions = el("div", "artifact-actions");
  const loadButton = el("button", "ws-button", "读取 Artifacts");
  const stats = el("span", "actor-stats", "");
  actions.append(loadButton, stats);

  const list = el("div", "artifact-list");

  card.append(header, actions, list);
  root.replaceChildren(card);

  let disposed = false;

  const renderList = (result: ArtifactsLoadResult): void => {
    list.replaceChildren();
    stats.textContent = `${result.artifacts.length} 个 artifact · answer ${result.answerChars} 字符`;
    if (result.artifacts.length === 0) {
      list.append(el("div", "artifact-empty", "还没有 artifact。让模型生成一个 ```html 或 ```svg 代码块。"));
      return;
    }

    for (const artifact of result.artifacts) {
      const plan = renderArtifactSrcdoc(artifact);
      const item = el("div", "artifact-item");

      const itemHeader = el("div", "artifact-item-header");
      itemHeader.append(
        el("span", "ws-tag", `#${artifact.index}`),
        el("span", "ws-tag", artifact.language || "(无语言)"),
        el(
          "span",
          plan.kind === "render" ? "ws-tag artifact-kind-render" : "ws-tag",
          plan.kind === "render" ? "render" : "code",
        ),
      );

      const code = el("pre", "artifact-code", artifact.code);
      item.append(itemHeader, code);

      if (plan.kind === "render") {
        const openButton = el("button", "ws-button", "在沙箱中打开");
        const sandboxBox = el("div", "artifact-sandbox");
        openButton.addEventListener("click", () => {
          if (sandboxBox.firstChild) {
            sandboxBox.replaceChildren();
            openButton.textContent = "在沙箱中打开";
            return;
          }
          const iframe = document.createElement("iframe");
          iframe.className = "artifact-iframe";
          iframe.setAttribute("sandbox", plan.sandbox);
          iframe.srcdoc = plan.srcdoc;
          sandboxBox.replaceChildren(iframe);
          openButton.textContent = "关闭沙箱";
        });
        const row = el("div", "artifact-sandbox-row");
        row.append(openButton);
        item.append(row, sandboxBox);
      } else {
        item.append(el("div", "artifact-note", plan.truncated ? "代码过大，仅展示代码" : "只读代码，不执行"));
      }

      list.append(item);
    }
  };

  loadButton.addEventListener("click", () => {
    loadButton.disabled = true;
    stats.textContent = "读取中…";
    void options
      .onLoadArtifacts()
      .then((result) => renderList(result))
      .catch((error: unknown) => {
        stats.textContent = "读取失败：" + (error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!disposed) loadButton.disabled = false;
      });
  });

  return {
    dispose(): void {
      disposed = true;
      root.replaceChildren();
    },
  };
}
