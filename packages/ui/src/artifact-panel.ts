/**
 * Artifacts panel — pure DOM, no network, no credential access.
 *
 * Lists fenced code blocks extracted from the current tab's answer stream.
 * Rendering happens in the canvas view (`artifact-canvas.ts`), which owns the
 * one sandbox frame; this panel's "在画布中打开" button hands the artifact
 * over. The sandbox attribute and srcdoc come from `renderArtifactSrcdoc`;
 * network isolation comes from the manifest sandbox page CSP. This panel does
 * no safety judgment of its own, it only assembles DOM.
 *
 * Scope: artifacts accumulate across turns by default, but the panel defaults
 * to showing only the most recent turn, with an explicit toggle for "all".
 *
 * Red lines enforced here:
 *  - code preview always uses `textContent` (never `innerHTML`);
 *  - the panel never creates an iframe itself — the canvas owns the only one,
 *    so there is exactly one sandbox frame per side panel, not one per item.
 */

import type { Artifact, ArtifactFeedback, ArtifactScope } from "@webos/shared";
import { renderArtifactSrcdoc } from "@webos/shared";
import { getArtifactRuntime } from "./artifact-runtime.js";
import { el } from "./dom.js";
import { describeRenderPlan } from "./render-plan-text.js";

export interface ArtifactsLoadResult {
  artifacts: Artifact[];
  answerChars: number;
  pageSessionId: string;
  tabId: number;
}

export interface ArtifactPanelOptions {
  onLoadArtifacts: (scope: ArtifactScope) => Promise<ArtifactsLoadResult>;
  /** Interaction feedback reported by a rendered artifact via `webos.report()`. */
  onFeedback?: (feedback: ArtifactFeedback) => void;
  /** Open one artifact in the canvas view (switches the view and force-renders). */
  onOpenInCanvas?: (artifact: Artifact) => void;
}

export interface ArtifactPanel {
  dispose(): void;
}

/** Cap for the list preview of renderable artifacts (see renderList). */
const PREVIEW_CHARS = 400;

const SCOPE_LABEL: Record<ArtifactScope, string> = {
  latest: "本轮",
  all: "全部",
};

export function mountArtifactPanel(root: HTMLElement, options: ArtifactPanelOptions): ArtifactPanel {
  const card = el("section", "actor-card");

  const header = el("div", "actor-header");
  const titleBox = el("div", "actor-titlebox");
  titleBox.append(
    el("div", "ws-title", "Artifacts · 沙箱"),
    el("div", "ws-subtitle", "模型输出的代码块，可渲染项在画布中打开，其余只读展示"),
  );
  header.append(titleBox);

  const actions = el("div", "artifact-actions");
  const loadButton = el("button", "ws-button", "读取 Artifacts");
  const latestButton = el("button", "ws-button", "仅本轮");
  const allButton = el("button", "ws-button ws-button-ghost", "全部");
  const stats = el("span", "actor-stats", "");
  actions.append(loadButton, latestButton, allButton, stats);

  const list = el("div", "artifact-list");

  card.append(header, actions, list);
  root.replaceChildren(card);

  let disposed = false;
  let currentScope: ArtifactScope = "latest";

  const setScopeButtons = (scope: ArtifactScope): void => {
    latestButton.className = scope === "latest" ? "ws-button" : "ws-button ws-button-ghost";
    allButton.className = scope === "all" ? "ws-button" : "ws-button ws-button-ghost";
  };

  const renderList = (result: ArtifactsLoadResult): void => {
    list.replaceChildren();
    const label = SCOPE_LABEL[currentScope];
    stats.textContent = `${label} ${result.artifacts.length} 个 artifact · answer ${result.answerChars} 字符`;
    if (result.artifacts.length === 0) {
      list.append(
        el(
          "div",
          "artifact-empty",
          currentScope === "latest"
            ? "本轮没有 artifact。让模型生成一个 ```html / ```svg / ```jsx 代码块。"
            : "本 tab 没有 artifact。让模型生成一个 ```html / ```svg / ```jsx 代码块。",
        ),
      );
      return;
    }

    for (const artifact of result.artifacts) {
      const plan = renderArtifactSrcdoc(artifact, { reactRuntime: getArtifactRuntime() });
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
      if (plan.kind === "render" && plan.runtime === "react") {
        itemHeader.append(el("span", "ws-tag", "react"));
      }

      // Renderable artifacts get a compact preview, not the full source: the
      // canvas shows the real thing, and a 10kb HTML wall in the list is
      // noise that pushes every other artifact below the fold.
      const preview =
        plan.kind === "render" && artifact.code.length > PREVIEW_CHARS
          ? artifact.code.slice(0, PREVIEW_CHARS) + `\n…（共 ${artifact.code.length} 字符，完整内容在画布中）`
          : artifact.code;
      const code = el("pre", "artifact-code", preview);
      item.append(itemHeader, code);

      if (plan.kind === "render") {
        // Hand the artifact to the canvas view: it owns the single sandbox
        // frame, so opening from here costs no new iframe.
        const openButton = el("button", "ws-button", "在画布中打开");
        openButton.addEventListener("click", () => options.onOpenInCanvas?.(artifact));
        const row = el("div", "artifact-sandbox-row");
        row.append(openButton);
        item.append(row);
      } else {
        // Why it is code-only — one shared sentence, same as the canvas shows.
        item.append(el("div", "artifact-note", describeRenderPlan(plan)));
      }

      list.append(item);
    }
  };

  const load = (scope: ArtifactScope): void => {
    currentScope = scope;
    setScopeButtons(scope);
    loadButton.disabled = true;
    stats.textContent = "读取中…";
    void options
      .onLoadArtifacts(scope)
      .then((result) => renderList(result))
      .catch((error: unknown) => {
        stats.textContent = "读取失败：" + (error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!disposed) loadButton.disabled = false;
      });
  };

  loadButton.addEventListener("click", () => load(currentScope));
  latestButton.addEventListener("click", () => load("latest"));
  allButton.addEventListener("click", () => load("all"));

  return {
    dispose(): void {
      disposed = true;
      root.replaceChildren();
    },
  };
}
