/**
 * PageAct wire contract.
 *
 * The Action DSL lives here, not in the page-act package, because four
 * parties speak it: the model emits it, the service worker validates it,
 * the content script executes it, and the side panel describes it to the
 * user. A contract that four parties share cannot live inside one of them.
 *
 * The validation and execution LOGIC lives in `@webos/page-act`; only the
 * shapes are here.
 */

/** What the model is allowed to ask for. */
export type PageAction =
  | { kind: "click"; selector: string }
  | { kind: "fill"; selector: string; value: string }
  | { kind: "scroll"; to: "top" | "bottom" | { selector: string } }
  | { kind: "extract"; selector: string; as: "text" | "table" }
  | { kind: "waitFor"; selector: string; timeoutMs: number }
  | { kind: "nextPage"; selector: string }
  /** Assemble everything extracted so far in the batch into a CSV download. */
  | { kind: "export"; format: "csv" };

export type PageActionKind = PageAction["kind"];

/** Hard limits. A DSL without limits is a denial-of-service vector. */
export const PAGE_ACTION_LIMITS = {
  /** Longest CSS selector we accept. */
  maxSelectorChars: 200,
  /** Longest value we type into a field. */
  maxValueChars: 1000,
  /** Bounds for `waitFor`. */
  minTimeoutMs: 100,
  maxTimeoutMs: 30_000,
} as const;

/**
 * Why an action needs a human "yes" before it runs.
 *
 * `download` — the click would start a file download.
 * `submit`  — the click would submit a form.
 * `credential` — the field holds a password or a card number.
 * `destructive` — the click would delete or overwrite something.
 */
export type PageDanger = "download" | "submit" | "credential" | "destructive";

/** Which dangers belong to which action. */
export const DANGER_BY_KIND: Readonly<Record<PageActionKind, readonly PageDanger[]>> = {
  click: ["download", "submit", "destructive"],
  fill: ["credential"],
  scroll: [],
  extract: [],
  waitFor: [],
  nextPage: ["download", "submit", "destructive"],
  export: ["download"],
};

/**
 * A dangerous action waiting for the user's decision.
 *
 * `summary` is already rendered for a human — the UI shows it verbatim
 * instead of rebuilding it from the action, so the prompt and the log can
 * never disagree.
 */
export interface PageActConfirmRequest {
  /** Correlation id; the answer carries it back. */
  id: string;
  action: PageAction;
  /** One-line Chinese summary of the action. */
  summary: string;
  danger: PageDanger;
  /** What the target element looks like ("button.submit"). */
  element: string;
  /** How many actions are still queued behind this one (context). */
  remaining?: number;
}

/** The user's answer. */
export interface PageActConfirmResponse {
  id: string;
  approved: boolean;
}

/**
 * How a confirmation ended.
 *
 * `timeout` and `no-ui` both mean "not approved" — the caller must treat
 * them as a refusal, never as consent.
 */
export type ConfirmOutcome = "approved" | "refused" | "timeout" | "no-ui";
