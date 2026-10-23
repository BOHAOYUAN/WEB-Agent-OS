/**
 * PageAct host — the service-worker side of page control.
 *
 * Three jobs, in order of importance:
 *
 *   1. **Domain allowlist.** The worker refuses to drive a tab it does not
 *      own. The manifest already limits which pages the content script runs
 *      on; this is the second lock on the same door, so a bug in the caller
 *      cannot turn the extension into a page hijacker.
 *   2. **Confirmation registry.** A dangerous action pauses and asks the side
 *      panel. Silence means refusal: no panel listening → "no-ui", nobody
 *      answering → "timeout". Only an explicit click on "允许" counts.
 *   3. **The bridge** to the content script that actually touches the DOM.
 *
 * The confirmation round trip:
 *
 *   content script ──sendMessage──▶ worker ──UI port──▶ side panel
 *                 ◀──sendResponse──  worker ◀──sendMessage──┘
 *
 * The content script's message channel stays open while the user decides;
 * that is what `return true` from the onMessage listener is for. A worker
 * that returned early would resolve the request as "no answer" — which is
 * the refusal path, so the bug would look like a policy decision rather
 * than a failure.
 */

import { ConfirmRegistry, isApproved } from "@webos/page-act";
import type {
  ConfirmOutcome,
  PageActConfirmRequest,
  PageActConfirmResponse,
  UiMessage,
} from "@webos/shared";
import { validatePageActions } from "@webos/page-act";

/**
 * Hosts the worker may drive.
 *
 * The shipped build drives exactly one host — the same single host the
 * extension declares in `host_permissions`. Widening it is a product
 * decision (and a Web Store review question), not a code change — it happens
 * here, explicitly.
 *
 * Dev builds additionally allow the loopback hosts, mirroring the sensor's
 * own `isAllowedUrl` rule: the local demo (and a locally deployed DeepSeek)
 * is where PageAct gets exercised first, and it must never require editing
 * this file.
 */
export const PAGE_ACT_ALLOWED_HOSTS: readonly string[] = __DEV__
  ? ["chat.deepseek.com", "localhost", "127.0.0.1"]
  : ["chat.deepseek.com"];

export interface PageActHostOptions {
  /** Push a message to the connected side panel(s). */
  broadcast: (message: UiMessage) => void;
  /** Is any side panel connected? Used to fail fast when nobody can answer. */
  hasPanel: () => boolean;
  /** Override the allowed hosts (tests). */
  allowedHosts?: readonly string[];
}

export interface PageActRunOutcome {
  ok: boolean;
  results?: unknown[];
  error?: string;
  /** Set when the batch ended in a CSV export (download fired). */
  exported?: { filename: string; rows: number };
}

export interface PageActConfirmOutcome {
  approved: boolean;
  outcome: ConfirmOutcome;
}

export class PageActHost {
  private readonly registry = new ConfirmRegistry();
  private readonly broadcast: (message: UiMessage) => void;
  private readonly hasPanel: () => boolean;
  private readonly allowedHosts: readonly string[];

  constructor(options: PageActHostOptions) {
    this.broadcast = options.broadcast;
    this.hasPanel = options.hasPanel;
    this.allowedHosts = options.allowedHosts ?? PAGE_ACT_ALLOWED_HOSTS;
  }

  /** Is this tab one the worker is allowed to drive? */
  async isAllowedTab(tabId: number): Promise<boolean> {
    try {
      const tab = await chrome.tabs.get(tabId);
      const url = tab.url ?? "";
      if (!url) return false;
      const host = new URL(url).hostname;
      return this.allowedHosts.includes(host);
    } catch {
      return false;
    }
  }

  /**
   * Run a batch of actions in a tab.
   *
   * The worker validates before the content script sees anything: the
   * content script validates again (last gate before the DOM), but the
   * worker must not be the one forwarding nonsense either.
   */
  async run(tabId: number, actions: unknown): Promise<PageActRunOutcome> {
    if (!(await this.isAllowedTab(tabId))) {
      return { ok: false, error: "该页面不在允许操控的域名白名单内" };
    }
    const validation = validatePageActions(actions);
    if (!validation.ok) {
      return { ok: false, error: validation.reason };
    }
    try {
      const response = (await chrome.tabs.sendMessage(tabId, {
        kind: "webos/pageact.run",
        v: 1,
        actions: validation.actions,
      })) as { ok?: boolean; results?: unknown[]; error?: string } | undefined;
      if (!response) return { ok: false, error: "页面脚本没有响应" };
      if (response.ok === false) return { ok: false, error: response.error ?? "执行失败", results: response.results };
      const results = response.results ?? [];
      const exported = await this.downloadIfExported(results);
      return exported ? { ok: true, results, exported } : { ok: true, results };
    } catch {
      return { ok: false, error: "无法与页面通信（该标签页可能没有加载扩展脚本）" };
    }
  }

  /**
   * When a batch ends in an `export` action, its result carries the assembled
   * CSV. The content script cannot download (no `chrome.downloads` in an
   * ISOLATED world), so the worker does it here. Approval already happened
   * inside the executor — this is a plain hand-off, not a policy decision.
   */
  private async downloadIfExported(results: unknown[]): Promise<{ filename: string; rows: number } | null> {
    for (const result of results) {
      const exported = (result as { export?: { format?: string; csv?: string; rowCount?: number } } | null)?.export;
      if (!exported || typeof exported.csv !== "string") continue;
      const filename = `pageact-export-${Date.now()}.csv`;
      const dataUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(exported.csv)}`;
      try {
        await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
      } catch {
        // Best-effort: the download is reported even if the browser refused it.
      }
      return { filename, rows: exported.rowCount ?? 0 };
    }
    return null;
  }

  /**
   * Ask the user about a dangerous action.
   *
   * Returns the decision. `approved` is true only for an explicit "允许".
   */
  async requestConfirmation(request: PageActConfirmRequest): Promise<PageActConfirmOutcome> {
    if (!this.hasPanel()) {
      // Nobody can answer → refuse. The alternative — waiting for a panel
      // that may never open — would leave a dangerous action hanging.
      return { approved: false, outcome: "no-ui" };
    }
    this.broadcast({ kind: "webos/ui.pageact.confirm", request });
    const outcome = await this.registry.request(request);
    return { approved: isApproved(outcome), outcome };
  }

  /** Relay the user's answer. False when the request is unknown or expired. */
  answer(response: PageActConfirmResponse): boolean {
    return this.registry.answer(response);
  }

  /** The requests still waiting (for a panel that reconnected). */
  pending(): PageActConfirmRequest[] {
    return this.registry.list();
  }

  /** Refuse everything waiting — used when the panel goes away. */
  refuseAll(): void {
    this.registry.refuseAll();
  }
}
