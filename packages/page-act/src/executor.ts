/**
 * Executor — performs validated actions against a page.
 *
 * The executor never touches `document`. Everything the page offers comes
 * through `PageEnvironment`, which buys three things:
 *   1. this file is pure enough to unit-test in node (this repo has no
 *      jsdom, and adding one is not worth it for six DOM calls);
 *   2. the real DOM adapter stays a thin, obvious layer instead of being
 *      tangled into control flow;
 *   3. a test can describe a dangerous page without needing one.
 *
 * Safety rules enforced here, not by the caller:
 *   - a dangerous action (download / form submit / credential field) runs
 *     ONLY after `confirm` approves it; without a `confirm` callback it is
 *     refused. **Dangerous does not run unconfirmed.**
 *   - a batch stops at the first failure — a page whose state surprised us
 *     is not a page we should keep clicking on.
 *   - batches are bounded: total actions and total pagination steps.
 */

import {
  describeAction,
  describeDanger,
  isDangerousFor,
  type PageAction,
  type PageDanger,
} from "./dsl.js";
import { buildCsv } from "./export.js";

/** A page element, as far as the executor is concerned. */
export interface PageElement {
  /** Short human description for error messages, e.g. "button.submit". */
  readonly describe: string;
  /** Visible text (the executor trims it). */
  readonly textContent: string;
  /** Danger hint computed by the DOM adapter; null when harmless. */
  readonly danger?: PageDanger | null;
  /** Perform a click (the adapter handles the synthetic-event details). */
  click(): void;
  /** Set the field value in a way frameworks notice. */
  setValue(value: string): void;
  /** Bring the element into view. */
  scrollIntoView(): void;
  /** Rows of a table element; the first row is the header. */
  rows(): string[][];
}

/** The page, as far as the executor is concerned. */
export interface PageEnvironment {
  /** First element matching the selector, or null. */
  query(selector: string): PageElement | null;
  /** Every element matching the selector. */
  queryAll(selector: string): PageElement[];
  /** Scroll the window to the top or the bottom. */
  scrollWindow(to: "top" | "bottom"): void;
  /** Wait for a selector to appear; null when the timeout elapses. */
  waitFor(selector: string, timeoutMs: number): Promise<PageElement | null>;
}

/** What the confirmation prompt needs to show the user. */
export interface ConfirmationRequest {
  action: PageAction;
  /** One-line summary of the action. */
  summary: string;
  /** Why it is dangerous. */
  danger: PageDanger;
  /** What the target element looks like. */
  element: string;
}

export interface ExecutorOptions {
  /**
   * Approve a dangerous action. Returning false (or omitting this callback)
   * refuses the action — the default is "refuse", never "allow".
   */
  confirm?: (request: ConfirmationRequest) => Promise<boolean> | boolean;
  /** Max actions in one batch. */
  maxActions?: number;
  /** Max pagination steps in one batch (a runaway-loop breaker). */
  maxPaginationSteps?: number;
}

/** Data produced by an `extract` action. */
export type ExtractData =
  | { kind: "text"; text: string }
  | { kind: "table"; header: string[]; rows: string[][] };

export interface ExecutionResult {
  ok: boolean;
  action: PageAction;
  /** Human-readable outcome (Chinese). */
  message: string;
  /** Set when the action was refused rather than attempted. */
  refused?: boolean;
  /** Present for `extract` actions. */
  data?: ExtractData;
  /** Present for `export` actions: the assembled CSV. */
  export?: { format: "csv"; csv: string; rowCount: number };
}

/** Default caps. Deliberately small: a batch is a scripted gesture, not a crawl. */
export const DEFAULT_MAX_ACTIONS = 20;
export const DEFAULT_MAX_PAGINATION_STEPS = 10;

function fail(action: PageAction, message: string, refused = false): ExecutionResult {
  return refused ? { ok: false, action, message, refused: true } : { ok: false, action, message };
}

async function approve(
  action: PageAction,
  danger: PageDanger,
  element: PageElement,
  options: ExecutorOptions,
): Promise<boolean> {
  if (!options.confirm) return false;
  const approved = await options.confirm({
    action,
    summary: describeAction(action),
    danger,
    element: element.describe,
  });
  return approved === true;
}

/**
 * Run one validated action.
 *
 * The action is assumed to have passed `validatePageAction` — the executor
 * does not re-validate, but it does defend against a throwing page.
 */
export async function executeAction(
  action: PageAction,
  environment: PageEnvironment,
  options: ExecutorOptions = {},
): Promise<ExecutionResult> {
  try {
    switch (action.kind) {
      case "click":
      case "nextPage": {
        const element = environment.query(action.selector);
        if (!element) return fail(action, `找不到元素：${action.selector}`);
        const danger = element.danger ?? null;
        if (danger && isDangerousFor(action, danger)) {
          const approved = await approve(action, danger, element, options);
          if (!approved) {
            return fail(action, `已拒绝：${describeAction(action)}（${describeDanger(danger)}）`, true);
          }
        }
        element.click();
        return { ok: true, action, message: `${describeAction(action)} → 已执行` };
      }
      case "fill": {
        const element = environment.query(action.selector);
        if (!element) return fail(action, `找不到元素：${action.selector}`);
        const danger = element.danger ?? null;
        if (danger && isDangerousFor(action, danger)) {
          const approved = await approve(action, danger, element, options);
          if (!approved) {
            return fail(action, `已拒绝：${describeAction(action)}（${describeDanger(danger)}）`, true);
          }
        }
        element.setValue(action.value);
        return { ok: true, action, message: `${describeAction(action)} → 已执行` };
      }
      case "scroll": {
        if (action.to === "top" || action.to === "bottom") {
          environment.scrollWindow(action.to);
          return { ok: true, action, message: `${describeAction(action)} → 已执行` };
        }
        const element = environment.query(action.to.selector);
        if (!element) return fail(action, `找不到元素：${action.to.selector}`);
        element.scrollIntoView();
        return { ok: true, action, message: `${describeAction(action)} → 已执行` };
      }
      case "extract": {
        const element = environment.query(action.selector);
        if (!element) return fail(action, `找不到元素：${action.selector}`);
        if (action.as === "text") {
          const text = element.textContent.trim();
          return {
            ok: true,
            action,
            message: `已读取 ${action.selector}（${text.length} 字符）`,
            data: { kind: "text", text },
          };
        }
        const rows = element.rows();
        const header = rows[0] ?? [];
        const body = rows.slice(1);
        return {
          ok: true,
          action,
          message: `已读取 ${action.selector}（${body.length} 行 × ${header.length} 列）`,
          data: { kind: "table", header, rows: body },
        };
      }
      case "waitFor": {
        const element = await environment.waitFor(action.selector, action.timeoutMs);
        if (!element) return fail(action, `等待超时：${action.selector}`);
        return { ok: true, action, message: `${describeAction(action)} → 已出现` };
      }
      default:
        return fail(action, "未知动作", true);
    }
  } catch (error) {
    // A malformed selector throws inside query(); a page can throw anywhere.
    // Neither may take the extension down.
    return fail(action, `执行失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Run a batch of actions.
 *
 * Stops at the first failure or refusal: continuing to click after the page
 * stopped looking the way we expected is how a script turns into an incident.
 */
export async function executeActions(
  actions: readonly PageAction[],
  environment: PageEnvironment,
  options: ExecutorOptions = {},
): Promise<ExecutionResult[]> {
  const maxActions = options.maxActions ?? DEFAULT_MAX_ACTIONS;
  const maxPaginationSteps = options.maxPaginationSteps ?? DEFAULT_MAX_PAGINATION_STEPS;
  const results: ExecutionResult[] = [];
  let paginationSteps = 0;

  for (const [index, action] of actions.entries()) {
    if (index >= maxActions) {
      results.push(fail(action, `批次超过上限（${maxActions} 个动作），已停止`, true));
      break;
    }
    if (action.kind === "nextPage") {
      paginationSteps += 1;
      if (paginationSteps > maxPaginationSteps) {
        results.push(fail(action, `翻页次数超过上限（${maxPaginationSteps}），已停止`, true));
        break;
      }
    }
    // Export does not touch the DOM; it serializes what this batch already
    // extracted. Handled here (not in `executeAction`) because it needs the
    // accumulated results.
    if (action.kind === "export") {
      const result = await executeExport(action, results, options);
      results.push(result);
      if (!result.ok) break;
      continue;
    }
    const result = await executeAction(action, environment, options);
    results.push(result);
    if (!result.ok) break;
  }
  return results;
}

/**
 * The `export` action: assemble every `extract` result collected so far into
 * a CSV string, after the user approves the download. Returns an
 * `ExecutionResult` carrying the CSV; the service worker turns it into a real
 * `chrome.downloads` call — the content script cannot download.
 */
async function executeExport(
  action: Extract<PageAction, { kind: "export" }>,
  prior: readonly ExecutionResult[],
  options: ExecutorOptions,
): Promise<ExecutionResult> {
  // A download must be approved. No confirm callback → refuse (default-refuse).
  if (options.confirm) {
    const approved = await options.confirm({
      action,
      summary: describeAction(action),
      danger: "download",
      element: "CSV 文件",
    });
    if (approved !== true) {
      return fail(action, `已拒绝：${describeAction(action)}（会触发文件下载）`, true);
    }
  } else {
    return fail(action, "导出需要确认，但当前没有确认渠道", true);
  }

  const extracted = prior.filter((r) => r.data).map((r) => r.data as ExtractData);
  const { csv, rowCount } = buildCsv(extracted);
  if (rowCount === 0) {
    return fail(action, "没有可导出的数据（前面没有成功的 extract）");
  }
  return { ok: true, action, message: `已生成 CSV（${rowCount} 行）`, export: { format: "csv", csv, rowCount } };
}
