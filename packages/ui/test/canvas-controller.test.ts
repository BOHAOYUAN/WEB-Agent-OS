import { describe, expect, it } from "vitest";
import {
  activateCanvas,
  canvasShouldShowDot,
  createCanvasState,
  forceRenderArtifact,
  ingestArtifact,
  setAutoRender,
} from "../src/canvas-controller.js";

describe("canvas auto-render state machine", () => {
  it("renders a new artifact when auto-render is on", () => {
    const first = ingestArtifact(createCanvasState(true), "sig-a", false);
    expect(first.decision).toEqual({ action: "render" });
    expect(first.state.renderedSignature).toBe("sig-a");
    expect(first.state.pendingCount).toBe(1); // arrived while not looking
  });

  it("does not light the dot for a render the user is watching", () => {
    const first = ingestArtifact(createCanvasState(true), "sig-a", true);
    expect(first.decision.action).toBe("render");
    expect(first.state.pendingCount).toBe(0);
    expect(canvasShouldShowDot(first.state)).toBe(false);
  });

  it("skips an artifact that is already on screen", () => {
    const first = ingestArtifact(createCanvasState(true), "sig-a", true);
    const again = ingestArtifact(first.state, "sig-a", true);
    expect(again.decision).toEqual({ action: "skip", reason: "duplicate" });
    expect(again.state).toBe(first.state); // untouched, not even a copy
  });

  it("skips a re-push of a seen-but-unrendered artifact without losing it", () => {
    // Auto off: A is seen but never rendered. A repeat push must not render
    // it (the toggle is off) and must not double-count pending.
    const off = createCanvasState(false);
    const first = ingestArtifact(off, "sig-a", false);
    expect(first.decision).toEqual({ action: "skip", reason: "auto-off" });
    expect(first.state.pendingCount).toBe(1);
    const second = ingestArtifact(first.state, "sig-a", false);
    expect(second.decision).toEqual({ action: "skip", reason: "duplicate" });
    expect(second.state.pendingCount).toBe(1);
  });

  it("renders after auto-render is switched on and the canvas is opened", () => {
    // The regression this state machine exists for: OFF → A arrives → user
    // turns auto ON → opens canvas → refresh pull re-ingests A. Dedupe must
    // compare against renderedSignature, so A finally renders.
    const off = ingestArtifact(createCanvasState(false), "sig-a", false).state;
    const on = setAutoRender(off, true);
    const opened = ingestArtifact(activateCanvas(on), "sig-a", true);
    expect(opened.decision).toEqual({ action: "render" });
    expect(opened.state.renderedSignature).toBe("sig-a");
  });

  it("force-renders through the toggle and clears the pending count", () => {
    const waiting = ingestArtifact(createCanvasState(false), "sig-a", false).state;
    expect(waiting.pendingCount).toBe(1);
    const forced = forceRenderArtifact(waiting, "sig-a");
    expect(forced.decision).toEqual({ action: "render" });
    expect(forced.state.renderedSignature).toBe("sig-a");
    expect(forced.state.pendingCount).toBe(0);
  });

  it("treats a missing artifact as nothing to render", () => {
    const result = ingestArtifact(createCanvasState(true), null, true);
    expect(result.decision).toEqual({ action: "skip", reason: "no-renderable" });
    const forced = forceRenderArtifact(createCanvasState(true), null);
    expect(forced.decision).toEqual({ action: "skip", reason: "no-renderable" });
  });

  it("clears the dot when the canvas view is activated", () => {
    const waiting = ingestArtifact(createCanvasState(false), "sig-a", false).state;
    expect(canvasShouldShowDot(waiting)).toBe(true);
    const opened = activateCanvas(waiting);
    expect(opened.pendingCount).toBe(0);
    expect(canvasShouldShowDot(opened)).toBe(false);
    // Idempotent: activating again returns the same object, no re-render churn.
    expect(activateCanvas(opened)).toBe(opened);
  });

  it("accumulates pending artifacts across turns while away", () => {
    let state = createCanvasState(true);
    state = ingestArtifact(state, "sig-a", false).state;
    state = ingestArtifact(state, "sig-b", false).state;
    expect(state.renderedSignature).toBe("sig-b");
    expect(state.pendingCount).toBe(2);
    expect(canvasShouldShowDot(state)).toBe(true);
  });

  it("keeps state identical when the toggle does not change", () => {
    const state = createCanvasState(true);
    expect(setAutoRender(state, true)).toBe(state);
    expect(setAutoRender(state, false).autoRender).toBe(false);
  });
});
