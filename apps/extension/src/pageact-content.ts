/**
 * PageAct content script — the only code that touches the page's DOM.
 *
 * ISOLATED world: it sees the DOM but not the page's JavaScript objects, so
 * a hostile page cannot hand it a fake element through a prototype trick.
 *
 * It is deliberately dumb: validate, execute, and ask the worker when a
 * dangerous action needs a human. All policy lives in the worker and in
 * `@webos/page-act` — nothing here decides what is allowed.
 */

import { createDomEnvironment, executeActions, validatePageActions } from "@webos/page-act";
import type { PageActConfirmRequest } from "@webos/shared";

let counter = 0;

function nextRequestId(): string {
  counter += 1;
  return `pageact-${Date.now().toString(36)}-${counter}`;
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const msg = message as { kind?: string; actions?: unknown };
  if (msg?.kind !== "webos/pageact.run") return false;

  void (async () => {
    // Last gate before the DOM. The worker validated too, but re-validating
    // here means a compromised worker still cannot inject an action.
    const validation = validatePageActions(msg.actions);
    if (!validation.ok) {
      sendResponse({ kind: "webos/pageact.run.result", ok: false, error: validation.reason });
      return;
    }

    const results = await executeActions(validation.actions, createDomEnvironment(), {
      confirm: async (confirmation) => {
        const request: PageActConfirmRequest = {
          id: nextRequestId(),
          action: confirmation.action,
          summary: confirmation.summary,
          danger: confirmation.danger,
          element: confirmation.element,
        };
        try {
          const response = (await chrome.runtime.sendMessage({
            kind: "webos/pageact.confirm.request",
            request,
          })) as { approved?: boolean } | undefined;
          // Only an explicit approval counts. No answer → refusal.
          return response?.approved === true;
        } catch {
          // The worker is gone or nobody is listening: refuse.
          return false;
        }
      },
    });

    sendResponse({ kind: "webos/pageact.run.result", ok: true, results });
  })();

  // Keep the message channel open: the response is sent asynchronously,
  // possibly minutes later — after the user has answered a confirmation.
  return true;
});
