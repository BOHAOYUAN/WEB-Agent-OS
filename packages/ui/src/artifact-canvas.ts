/**
 * Artifact canvas — the "Claude-style" right-hand stage inside the side panel.
 *
 * One sandbox frame is created lazily and reused for the whole session:
 * switching artifacts only calls `frame.render(srcdoc)`, so there is no
 * iframe churn. Non-renderable artifacts are shown as read-only code via
 * `textContent` (never innerHTML — model output is untrusted).
 *
 * Decision logic lives in `canvas-controller.ts`; this file is DOM assembly
 * and wiring only.
 *
 * Safety posture (unchanged from the artifact panel): the sandbox attribute
 * stays `allow-scripts` with NO `allow-same-origin`, the frame is opaque
 * origin with no network and no extension access. The auto-render toggle
 * changes WHO initiates the render, never what the render can do.
 */

import type { Artifact, ArtifactFeedback, ArtifactScope } from "@webos/shared";
import { artifactSignature, renderArtifactSrcdoc, selectAutoRenderArtifact } from "@webos/shared";
import { getArtifactRuntime } from "./artifact-runtime.js";
import type { ArtifactsLoadResult } from "./artifact-panel.js";
import { el } from "./dom.js";
import { describeRenderPlan } from "./render-plan-text.js";
import {
  activateCanvas,
  createCanvasState,
  forceRenderArtifact,
  ingestArtifact,
  setAutoRender,
  type CanvasState,
} from "./canvas-controller.js";
import { createSandboxFrame, type SandboxFrame } from "./sandbox-frame.js";

export interface ArtifactCanvasOptions {
  /** Refresh pull: used when the canvas becomes visible and on toggle-on. */
  onLoadArtifacts: (scope: ArtifactScope) => Promise<ArtifactsLoadResult>;
  /** Interaction feedback reported by a rendered artifact via `webos.report()`. */
  onFeedback?: (feedback: ArtifactFeedback) => void;
  /** Auto-render toggle changed (for persistence). */
  onAutoRenderChange?: (enabled: boolean) => void;
  /** Pending count changed (drives the canvas tab dot). */
  onPendingChange?: (count: number) => void;
  /** Whether the canvas view is currently visible — injected by the side panel. */
  isVisible?: () => boolean;
  /** Initial toggle state; the side panel restores the persisted value. */
  initialAutoRender?: boolean;
}

export interface ArtifactCanvas {
  /** A turn settled in the background: decide whether to auto-render. */
  ingestTurn(artifacts: Artifact[]): void;
  /** Force-render one artifact, bypassing the toggle (user clicked it). */
  openArtifact(artifact: Artifact): void;
  /** The canvas view became visible: clear the dot and refresh. */
  activate(): void;
  /** Update the toggle without persisting (used when restoring storage). */
  setAutoRender(enabled: boolean): void;
  dispose(): void;
}

const EMPTY_HINT = "本轮没有 artifact。让模型生成一个 ```html / ```svg / ```jsx 代码块。";

export function mountArtifactCanvas(root: HTMLElement, options: ArtifactCanvasOptions): ArtifactCanvas {
  const bar = el("div", "canvas-bar");
  const autoLabel = el("label", "canvas-auto");
  const autoBox = document.createElement("input");
  autoBox.type = "checkbox";
  autoBox.checked = options.initialAutoRender ?? true;
  autoLabel.append(autoBox, document.createTextNode("自动渲染"));
  const source = el("span", "canvas-source", "");
  const hint = el("span", "canvas-hint", "模型代码在沙箱中执行 · 可一键关闭");
  bar.append(autoLabel, source, hint);

  const stage = el("div", "canvas-stage");
  root.replaceChildren(bar, stage);

  let state: CanvasState = createCanvasState(options.initialAutoRender ?? true);
  let frame: SandboxFrame | null = null;
  let current: Artifact | null = null;

  const reportPending = (): void => options.onPendingChange?.(state.pendingCount);
  const reportSource = (): void => {
    source.textContent = current ? `#${current.index} · ${current.language || "(无语言)"}` : "";
  };

  const releaseFrame = (): void => {
    frame?.dispose();
    frame = null;
  };

  const showCode = (artifact: Artifact, reason: string): void => {
    releaseFrame();
    stage.replaceChildren(el("pre", "canvas-code", artifact.code), el("div", "canvas-note", reason));
  };

  const show = (artifact: Artifact): void => {
    current = artifact;
    const plan = renderArtifactSrcdoc(artifact, { reactRuntime: getArtifactRuntime() });
    if (plan.kind === "render") {
      // Lazy: the sandbox page costs one navigation, so it is created on the
      // first render and then reused for every subsequent artifact.
      if (!frame) {
        frame = createSandboxFrame({
          sandbox: plan.sandbox,
          src: "artifact-sandbox.html",
          className: "canvas-iframe",
          onFeedback: (feedback) => options.onFeedback?.(feedback),
        });
      }
      stage.replaceChildren(frame.element);
      frame.render(plan.srcdoc);
    } else {
      // Same explanation the artifact list shows — one shared sentence.
      showCode(artifact, describeRenderPlan(plan));
    }
    reportSource();
  };

  const showEmpty = (): void => {
    current = null;
    releaseFrame();
    stage.replaceChildren(el("div", "canvas-empty", EMPTY_HINT));
    reportSource();
  };

  const ingestTurn = (artifacts: Artifact[]): void => {
    const pick = selectAutoRenderArtifact(artifacts);
    const signature = pick ? artifactSignature(pick) : null;
    const transition = ingestArtifact(state, signature, options.isVisible?.() === true);
    state = transition.state;
    reportPending();
    if (transition.decision.action === "render" && pick) {
      show(pick);
    } else if (!current) {
      showEmpty();
    }
  };

  const activate = (): void => {
    state = activateCanvas(state);
    reportPending();
    // Refresh pull: covers "the panel was opened after the answer finished".
    // Dedupe by signature makes this free when nothing changed.
    void options
      .onLoadArtifacts("latest")
      .then((result) => ingestTurn(result.artifacts))
      .catch(() => undefined);
  };

  autoBox.addEventListener("change", () => {
    state = setAutoRender(state, autoBox.checked);
    options.onAutoRenderChange?.(state.autoRender);
    // Turning auto-render ON while looking at the canvas should show what was
    // waiting; the refresh pull goes through the same dedupe path.
    if (autoBox.checked && options.isVisible?.() === true) activate();
  });

  showEmpty();

  return {
    ingestTurn,
    openArtifact(artifact: Artifact): void {
      const transition = forceRenderArtifact(state, artifactSignature(artifact));
      state = transition.state;
      reportPending();
      if (transition.decision.action === "render") show(artifact);
    },
    activate,
    setAutoRender(enabled: boolean): void {
      state = setAutoRender(state, enabled);
      autoBox.checked = enabled;
    },
    dispose(): void {
      releaseFrame();
      root.replaceChildren();
    },
  };
}
