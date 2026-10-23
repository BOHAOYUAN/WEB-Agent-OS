/**
 * Canvas auto-render state machine — pure logic, no DOM.
 *
 * Lives in `packages/ui` next to the DOM component but imports nothing from
 * it, so the decision rules are unit-testable in plain node (this repo has no
 * jsdom).
 *
 * Two signatures are tracked, and the difference matters:
 *
 *  - `renderedSignature` — what the iframe is actually showing.
 *  - `seenSignature` — the newest artifact the background has told us about.
 *
 * Dedupe must compare against `renderedSignature`, not `seenSignature`.
 * Otherwise this sequence breaks: auto-render OFF → artifact A arrives (seen,
 * not rendered) → user turns auto ON → opens the canvas → the refresh pull
 * re-ingests A → "already seen" would skip it and the canvas stays empty even
 * though auto-render is on and the user is looking right at it.
 *
 * The complete duplicate rule is "already accounted for": on screen, OR (while
 * auto-render is off) already counted as pending. The second half stops a
 * repeated delivery of an unrendered artifact from double-counting the dot.
 *
 * `pendingCount` drives the tab dot: artifacts that arrived while the user
 * was NOT looking at the canvas. Renders witnessed live do not count.
 */

export interface CanvasState {
  /** User toggle (persisted). When off, pushes only bump the pending count. */
  autoRender: boolean;
  /** Signature of the artifact currently shown in the sandbox frame. */
  renderedSignature: string | null;
  /** Signature of the newest artifact seen from a background push or pull. */
  seenSignature: string | null;
  /** New artifacts waiting while the canvas was not visible. Drives the dot. */
  pendingCount: number;
}

export type CanvasDecision =
  | { action: "render" }
  | { action: "skip"; reason: "no-renderable" | "duplicate" | "auto-off" };

export interface CanvasTransition {
  state: CanvasState;
  decision: CanvasDecision;
}

const SKIP_NO_RENDERABLE: CanvasDecision = { action: "skip", reason: "no-renderable" };

export function createCanvasState(autoRender: boolean): CanvasState {
  return { autoRender, renderedSignature: null, seenSignature: null, pendingCount: 0 };
}

/**
 * Decide what to do with a newly arrived artifact (background push, or the
 * refresh pull when the canvas becomes visible).
 *
 * `visible` = the user is currently looking at the canvas view. A render that
 * happens while visible is witnessed, so it must not light the dot.
 */
export function ingestArtifact(
  state: CanvasState,
  signature: string | null,
  visible: boolean,
): CanvasTransition {
  if (signature === null) return { state, decision: SKIP_NO_RENDERABLE };

  // Already accounted for: either on screen, or (auto-render off) already
  // counted as pending. A repeat delivery must not double-count the dot.
  const accountedFor =
    signature === state.renderedSignature || (signature === state.seenSignature && !state.autoRender);
  if (accountedFor) {
    const decision: CanvasDecision = { action: "skip", reason: "duplicate" };
    // Preserve object identity when nothing changes: the DOM layer compares
    // pending counts, and churning state objects invites spurious re-renders.
    return state.seenSignature === signature ? { state, decision } : { state: { ...state, seenSignature: signature }, decision };
  }

  if (!state.autoRender) {
    return {
      state: { ...state, seenSignature: signature, pendingCount: state.pendingCount + 1 },
      decision: { action: "skip", reason: "auto-off" },
    };
  }

  return {
    state: {
      ...state,
      renderedSignature: signature,
      seenSignature: signature,
      pendingCount: visible ? state.pendingCount : state.pendingCount + 1,
    },
    decision: { action: "render" },
  };
}

/**
 * Force-render one specific artifact (the user clicked "在画布中打开").
 * Bypasses the auto-render toggle and clears the pending count — the user is
 * now looking at the canvas by definition.
 */
export function forceRenderArtifact(state: CanvasState, signature: string | null): CanvasTransition {
  if (signature === null) return { state, decision: SKIP_NO_RENDERABLE };
  return {
    state: { ...state, renderedSignature: signature, seenSignature: signature, pendingCount: 0 },
    decision: { action: "render" },
  };
}

/** The canvas view became visible: the dot clears. Rendering is the caller's
 *  job (it triggers the refresh pull, which flows through `ingestArtifact`). */
export function activateCanvas(state: CanvasState): CanvasState {
  return state.pendingCount === 0 ? state : { ...state, pendingCount: 0 };
}

/** Flip the toggle. Deliberately does NOT retroactively render: the next push
 *  or refresh pull decides. Turning it on while the canvas is open should be
 *  followed by a pull (the DOM component does exactly that). */
export function setAutoRender(state: CanvasState, autoRender: boolean): CanvasState {
  return state.autoRender === autoRender ? state : { ...state, autoRender };
}

export function canvasShouldShowDot(state: CanvasState): boolean {
  return state.pendingCount > 0;
}
