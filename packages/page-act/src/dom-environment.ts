/**
 * Real DOM adapter — the ONLY file in this package that touches `document`.
 *
 * It translates the page into the small interface the executor expects and
 * nothing else: no control flow, no policy. The policy (what is dangerous,
 * what needs confirmation) lives in the executor; the heuristics for "this
 * button downloads a file" live here, next to the DOM.
 *
 * Known gap: this file is not covered by unit tests — the repo has no jsdom
 * and adding one for six DOM calls is not worth it. The DOM-facing behaviour
 * (native value setter, synthetic click, table rows) is therefore verified by
 * the headless-browser runbook, not by `npm run verify`.
 */

import type { PageDanger } from "./dsl.js";
import type { PageElement, PageEnvironment } from "./executor.js";

/** Text patterns that make a button dangerous. Kept short on purpose. */
const SUBMIT_WORDS = /(提交|submit|确认支付|立即支付|付款|下单)/i;
const DOWNLOAD_WORDS = /(下载|download)/i;
const DESTRUCTIVE_WORDS = /(删除|清空|销毁|delete|remove|destroy)/i;

/** Longest text we are willing to pattern-match on (avoid page-wide false hits). */
const MAX_TEXT_MATCH = 16;

/**
 * Classify an element's danger.
 *
 * Conservative in the safe direction: structural signals first (a `download`
 * attribute, `type=password`, `type=submit`), then a short-text heuristic
 * for localized buttons.
 */
export function classifyDanger(element: Element): PageDanger | null {
  const tag = element.tagName.toLowerCase();
  const text = (element.textContent ?? "").trim();

  if (tag === "a") {
    if (element.hasAttribute("download")) return "download";
    if (text.length <= MAX_TEXT_MATCH && DOWNLOAD_WORDS.test(text)) return "download";
  }
  if (tag === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    if (type === "password" || type === "file") return "credential";
    const autocomplete = (element.getAttribute("autocomplete") ?? "").toLowerCase();
    if (autocomplete.includes("password") || autocomplete.startsWith("cc-")) return "credential";
    if (type === "submit" || type === "image") return "submit";
  }
  if (tag === "button") {
    if ((element.getAttribute("type") ?? "").toLowerCase() === "submit") return "submit";
  }
  if (text.length <= MAX_TEXT_MATCH) {
    if (DESTRUCTIVE_WORDS.test(text)) return "destructive";
    if (SUBMIT_WORDS.test(text)) return "submit";
    if (DOWNLOAD_WORDS.test(text)) return "download";
  }
  return null;
}

/** Short description for error messages: "button.submit". */
export function describeElement(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const className =
    typeof element.className === "string" && element.className.trim().length > 0
      ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
  return `${tag}${id}${className}`;
}

/**
 * Set a field value in a way frameworks notice.
 *
 * React (and Vue) install their own `value` setter on the element instance,
 * so assigning `element.value = x` updates the DOM but never the framework
 * state — the classic "the field shows my text but React thinks it is empty"
 * bug. Calling the prototype's native setter and then dispatching `input` is
 * the standard workaround.
 */
export function setNativeValue(element: Element, value: string): void {
  const tag = element.tagName.toLowerCase();
  const prototype =
    tag === "textarea"
      ? HTMLTextAreaElement.prototype
      : tag === "select"
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  const setter = descriptor?.set;
  if (setter) {
    setter.call(element as HTMLInputElement, value);
  } else {
    element.setAttribute("value", value);
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Rows of a table element; the first row is the header. */
export function extractRows(element: Element): string[][] {
  return Array.from(element.querySelectorAll("tr")).map((row) =>
    Array.from(row.querySelectorAll("th,td")).map((cell) => (cell.textContent ?? "").trim()),
  );
}

function wrap(element: Element): PageElement {
  return {
    describe: describeElement(element),
    get textContent(): string {
      return element.textContent ?? "";
    },
    get danger(): PageDanger | null {
      return classifyDanger(element);
    },
    click(): void {
      // `HTMLElement.click()` dispatches a bubbling, cancelable click that
      // React's synthetic event system sees. Elements without the method
      // (SVG, for instance) get a manual MouseEvent instead.
      const clickable = element as Element & { click?: () => void };
      if (typeof clickable.click === "function") {
        clickable.click();
        return;
      }
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    },
    setValue(value: string): void {
      setNativeValue(element, value);
    },
    scrollIntoView(): void {
      const scrollable = element as Element & { scrollIntoView?: (options?: unknown) => void };
      if (typeof scrollable.scrollIntoView === "function") {
        scrollable.scrollIntoView({ block: "center" });
        return;
      }
      element.scrollIntoView();
    },
    rows(): string[][] {
      return extractRows(element);
    },
  };
}

/**
 * Build an environment over a document.
 *
 * `root` defaults to the current document; pass an element to scope the
 * actions to a subtree (e.g. one dialog).
 */
export function createDomEnvironment(root: Document | Element = document): PageEnvironment {
  const scope = root;
  return {
    query(selector: string): PageElement | null {
      try {
        const found = scope.querySelector(selector);
        return found ? wrap(found) : null;
      } catch {
        // An invalid selector throws; treat it as "not found" rather than
        // letting a typo take the whole batch down.
        return null;
      }
    },
    queryAll(selector: string): PageElement[] {
      try {
        return Array.from(scope.querySelectorAll(selector)).map((element) => wrap(element));
      } catch {
        return [];
      }
    },
    scrollWindow(to: "top" | "bottom"): void {
      const view = scope.ownerDocument?.defaultView;
      if (!view) return;
      const height = scope.ownerDocument?.documentElement?.scrollHeight ?? 0;
      view.scrollTo(0, to === "top" ? 0 : height);
    },
    async waitFor(selector: string, timeoutMs: number): Promise<PageElement | null> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = this.query(selector);
        if (found) return found;
        if (Date.now() >= deadline) return null;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
  };
}
