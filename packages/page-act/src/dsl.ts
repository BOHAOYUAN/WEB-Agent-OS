/**
 * Action DSL — the only vocabulary the model may use to drive a page.
 *
 * Design rule that makes the whole layer safe: **the model never emits
 * JavaScript**. It emits one of these declarative actions, the validator
 * accepts it or rejects it, and the executor performs it. There is no
 * `eval`, no "script" action kind, and no free-form code field.
 *
 * Everything here is pure data + pure functions: no DOM, no I/O, so the
 * contract is testable in node and the same file is used by the service
 * worker (validation), the content script (execution) and the side panel
 * (confirmation UI).
 */

import {
  DANGER_BY_KIND,
  PAGE_ACTION_LIMITS,
  describeAction,
  describeDanger,
  type PageAction,
  type PageActionKind,
  type PageDanger,
} from "@webos/shared";

// The shapes and the wording live in `@webos/shared` (the model, the service
// worker, the content script and the side panel all speak them); the
// validation lives here. Re-exported so a caller can import the whole
// vocabulary from one place.
export { DANGER_BY_KIND, PAGE_ACTION_LIMITS, describeAction, describeDanger };
export type { PageAction, PageActionKind, PageDanger };

export type PageActionValidation =
  | { ok: true; action: PageAction }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reject anything that is not a CSS selector.
 *
 * Not a full CSS parser — just the characters that have no business in a
 * selector and would suggest the model is trying to smuggle markup or a
 * block into the query. (`>` is legal CSS combinator syntax and stays.)
 */
export function isSafeSelector(selector: string): boolean {
  if (selector.length === 0) return false;
  if (selector.length > PAGE_ACTION_LIMITS.maxSelectorChars) return false;
  return !/[<{}]/.test(selector);
}

/** Exact key set per action kind — no extra fields, ever. */
const REQUIRED_KEYS: Readonly<Record<PageActionKind, readonly string[]>> = {
  click: ["kind", "selector"],
  fill: ["kind", "selector", "value"],
  scroll: ["kind", "to"],
  extract: ["kind", "selector", "as"],
  waitFor: ["kind", "selector", "timeoutMs"],
  nextPage: ["kind", "selector"],
  export: ["kind", "format"],
};

/**
 * Validate one action.
 *
 * This is the single gate before anything touches a page: unknown kinds,
 * missing fields, extra fields, wrong types and out-of-range numbers are all
 * rejected here. The executor assumes a validated action.
 */
export function validatePageAction(value: unknown): PageActionValidation {
  if (!isRecord(value)) return { ok: false, reason: "action must be an object" };
  const kind = value.kind;
  if (typeof kind !== "string" || !(kind in REQUIRED_KEYS)) {
    return { ok: false, reason: "unknown action kind" };
  }
  const allowed = REQUIRED_KEYS[kind as PageActionKind];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      return { ok: false, reason: `unexpected field "${key}" for ${kind}` };
    }
  }
  for (const key of allowed) {
    if (!(key in value)) return { ok: false, reason: `missing field "${key}" for ${kind}` };
  }

  const selector = value.selector;
  if (selector !== undefined) {
    if (typeof selector !== "string") return { ok: false, reason: "selector must be a string" };
    if (!isSafeSelector(selector)) return { ok: false, reason: "unsafe or oversized selector" };
  }

  switch (kind as PageActionKind) {
    case "click":
    case "nextPage":
      return { ok: true, action: { kind, selector: selector as string } as PageAction };
    case "fill": {
      const fillValue = value.value;
      if (typeof fillValue !== "string") return { ok: false, reason: "value must be a string" };
      if (fillValue.length > PAGE_ACTION_LIMITS.maxValueChars) {
        return { ok: false, reason: "value too long" };
      }
      return { ok: true, action: { kind: "fill", selector: selector as string, value: fillValue } };
    }
    case "scroll": {
      const to = value.to;
      if (to === "top" || to === "bottom") return { ok: true, action: { kind: "scroll", to } };
      if (isRecord(to)) {
        // Strict: the nested target is a selector, nothing else.
        const keys = Object.keys(to);
        if (keys.length !== 1 || keys[0] !== "selector") {
          return { ok: false, reason: "scroll target must carry only a selector" };
        }
        if (typeof to.selector !== "string") return { ok: false, reason: "scroll selector must be a string" };
        if (!isSafeSelector(to.selector)) return { ok: false, reason: "unsafe or oversized selector" };
        return { ok: true, action: { kind: "scroll", to: { selector: to.selector } } };
      }
      return { ok: false, reason: "scroll target must be top, bottom or a selector" };
    }
    case "extract": {
      const as = value.as;
      if (as !== "text" && as !== "table") return { ok: false, reason: "extract mode must be text or table" };
      return { ok: true, action: { kind: "extract", selector: selector as string, as } };
    }
    case "waitFor": {
      const timeoutMs = value.timeoutMs;
      if (!Number.isInteger(timeoutMs)) return { ok: false, reason: "timeoutMs must be an integer" };
      if (
        (timeoutMs as number) < PAGE_ACTION_LIMITS.minTimeoutMs ||
        (timeoutMs as number) > PAGE_ACTION_LIMITS.maxTimeoutMs
      ) {
        return { ok: false, reason: "timeoutMs out of range" };
      }
      return { ok: true, action: { kind: "waitFor", selector: selector as string, timeoutMs: timeoutMs as number } };
    }
    case "export": {
      // Only csv today. xlsx needs SheetJS, which is a new dependency and
      // therefore a whitelist-PR decision — not a field we quietly accept.
      if (value.format !== "csv") return { ok: false, reason: "export format must be csv" };
      return { ok: true, action: { kind: "export", format: "csv" } };
    }
    default:
      return { ok: false, reason: "unknown action kind" };
  }
}

export type PageActionsValidation =
  | { ok: true; actions: PageAction[] }
  | { ok: false; reason: string };

/** Validate a batch: every action must pass, or the whole batch is refused. */
export function validatePageActions(value: unknown): PageActionsValidation {
  if (!Array.isArray(value)) return { ok: false, reason: "actions must be an array" };
  const actions: PageAction[] = [];
  for (const [index, item] of value.entries()) {
    const result = validatePageAction(item);
    if (!result.ok) return { ok: false, reason: `action[${index}]: ${result.reason}` };
    actions.push(result.action);
  }
  return { ok: true, actions };
}

/** Whether a danger (as reported by the page) is dangerous for this action. */
export function isDangerousFor(action: PageAction, danger: PageDanger): boolean {
  return DANGER_BY_KIND[action.kind].includes(danger);
}
