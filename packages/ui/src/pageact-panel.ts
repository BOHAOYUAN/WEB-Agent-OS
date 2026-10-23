/**
 * PageAct console — run actions in the current tab and ask the user about
 * the dangerous ones.
 *
 * Two pieces:
 *  - **the console**: a JSON textarea plus a 执行 button. Until the router
 *    learns to propose actions, this is the manual trigger — the same kind
 *    of console the debug panel already is.
 *  - **the confirmation card**: appears when a dangerous action needs a
 *    human. 允许 runs it, 拒绝 stops the batch.
 *
 * The card is the visible half of a rule that lives in the executor: a
 * dangerous action does not run unconfirmed. This UI only reflects the
 * decision; it never decides on the user's behalf.
 */

import type { PageActConfirmRequest } from "@webos/shared";
import { describeDanger } from "@webos/shared";
import { el } from "./dom.js";

export interface PageActRunOutcome {
  ok: boolean;
  results?: unknown[];
  error?: string;
}

export interface PageActPanelOptions {
  /** Run a batch of actions in the active tab. */
  onRun: (actions: unknown) => Promise<PageActRunOutcome>;
  /** Answer a pending confirmation. */
  onAnswer: (id: string, approved: boolean) => Promise<void>;
}

export interface PageActPanel {
  /** A dangerous action is waiting for a decision. */
  showConfirm(request: PageActConfirmRequest): void;
  /** No confirmation is pending (e.g. it was answered elsewhere). */
  hideConfirm(): void;
  /** A model-proposed batch finished — surface its outcome in the console. */
  showRunResult(outcome: PageActRunOutcome): void;
  dispose(): void;
}

const SAMPLE = `[{"kind": "extract", "selector": "table", "as": "table"}]`;

export function mountPageActPanel(root: HTMLElement, options: PageActPanelOptions): PageActPanel {
  const card = el("section", "actor-card");

  const header = el("div", "actor-header");
  const titleBox = el("div", "actor-titlebox");
  titleBox.append(
    el("div", "ws-title", "页面动作 · PageAct"),
    el("div", "ws-subtitle", "只读抓取与点击；危险操作会先问你"),
  );
  header.append(titleBox);

  const area = document.createElement("textarea");
  area.className = "actor-textarea";
  area.rows = 4;
  area.value = SAMPLE;
  area.placeholder = '[{"kind":"click","selector":"#submit"}]';

  const actions = el("div", "actor-transcript-actions");
  const runButton = el("button", "ws-button", "执行");
  const status = el("span", "actor-stats", "");
  actions.append(runButton, status);

  const output = el("pre", "actor-result", "（尚未执行）");

  const confirmCard = el("div", "pageact-confirm");
  confirmCard.hidden = true;

  card.append(header, area, actions, output, confirmCard);
  root.replaceChildren(card);

  /**
   * Pending confirmations, oldest first.
   *
   * One prompt at a time: a second request arriving while one is open must
   * not replace it — the first action would hang until its timeout with
   * nobody able to answer it. The queue keeps both reachable.
   */
  const queue: PageActConfirmRequest[] = [];
  let pending: PageActConfirmRequest | null = null;

  const clearConfirm = (): void => {
    pending = null;
    confirmCard.hidden = true;
    confirmCard.replaceChildren();
  };

  const showNext = (): void => {
    const request = queue.shift();
    if (!request) {
      clearConfirm();
      return;
    }
    pending = request;
    confirmCard.replaceChildren();
    confirmCard.append(el("div", "pageact-confirm-title", "需要你确认"));
    confirmCard.append(el("div", "pageact-confirm-summary", request.summary));
    confirmCard.append(el("div", "pageact-confirm-danger", describeDanger(request.danger)));
    confirmCard.append(el("div", "pageact-confirm-element", `目标：${request.element}`));

    const row = el("div", "pageact-confirm-actions");
    const allow = el("button", "ws-button ws-button-danger", "允许");
    const deny = el("button", "ws-button ws-button-ghost", "拒绝");

    const answer = async (approved: boolean): Promise<void> => {
      allow.disabled = true;
      deny.disabled = true;
      try {
        await options.onAnswer(request.id, approved);
      } finally {
        allow.disabled = false;
        deny.disabled = false;
      }
      // The answered one leaves; the next in the queue gets the prompt.
      pending = null;
      showNext();
      status.textContent = approved ? "已允许，继续执行" : "已拒绝，批次停止";
    };

    allow.addEventListener("click", () => void answer(true));
    deny.addEventListener("click", () => void answer(false));
    row.append(allow, deny);
    confirmCard.append(row);
    confirmCard.hidden = false;
  };

  const showConfirm = (request: PageActConfirmRequest): void => {
    queue.push(request);
    if (pending) return; // one prompt is already open
    showNext();
  };

  runButton.addEventListener("click", () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(area.value);
    } catch (error) {
      status.textContent = "JSON 解析失败：" + (error instanceof Error ? error.message : String(error));
      return;
    }
    runButton.disabled = true;
    status.textContent = "执行中…";
    void options
      .onRun(parsed)
      .then((outcome) => {
        output.textContent = outcome.ok
          ? JSON.stringify(outcome.results ?? [], null, 2)
          : "失败：" + (outcome.error ?? "未知错误");
        status.textContent = outcome.ok ? "执行完成" : "执行失败";
      })
      .catch((error: unknown) => {
        output.textContent = "失败：" + (error instanceof Error ? error.message : String(error));
        status.textContent = "执行失败";
      })
      .finally(() => {
        runButton.disabled = false;
      });
  });

  return {
    showConfirm,
    hideConfirm: clearConfirm,
    showRunResult(outcome: PageActRunOutcome): void {
      output.textContent = outcome.ok
        ? `（模型触发）${JSON.stringify(outcome.results ?? [], null, 2)}`
        : `（模型触发）失败：${outcome.error ?? "未知错误"}`;
      status.textContent = outcome.ok ? "模型动作已执行" : "模型动作执行失败";
    },
    dispose(): void {
      root.replaceChildren();
    },
  };
}
