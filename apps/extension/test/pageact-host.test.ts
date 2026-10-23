import { beforeEach, describe, expect, it } from "vitest";
import type { PageActConfirmRequest, UiMessage } from "@webos/shared";

/**
 * The host reaches for `chrome.tabs`, so the mock has to exist BEFORE the
 * module is imported — the import has module-level side effects.
 */
let tabsGet: (tabId: number) => Promise<{ url?: string }>;
let tabsSend: (tabId: number, message: unknown) => Promise<unknown>;

function installChromeMock(): void {
  (globalThis as { chrome?: unknown }).chrome = {
    tabs: {
      get: (tabId: number) => tabsGet(tabId),
      sendMessage: (tabId: number, message: unknown) => tabsSend(tabId, message),
    },
  };
}

installChromeMock();

const { PageActHost } = await import("../src/pageact-host.js");

beforeEach(() => {
  tabsGet = async () => ({ url: "https://chat.deepseek.com/chat" });
  tabsSend = async () => ({ ok: true, results: [] });
  // Re-install: a previous test may have removed it, and the host reads
  // `chrome.tabs` on every call.
  installChromeMock();
});

function makeHost(options: { panel?: boolean; hosts?: string[] } = {}) {
  const broadcast: UiMessage[] = [];
  const host = new PageActHost({
    broadcast: (message) => broadcast.push(message),
    hasPanel: () => options.panel ?? true,
    allowedHosts: options.hosts ?? ["chat.deepseek.com"],
  });
  return { host, broadcast };
}

const confirmRequest = (id = "req-1"): PageActConfirmRequest => ({
  id,
  action: { kind: "click", selector: "#submit" },
  summary: "点击 #submit",
  danger: "submit",
  element: "button.submit",
});

describe("pageact host — domain allowlist", () => {
  it("allows a tab on a whitelisted host", async () => {
    const { host } = makeHost();
    expect(await host.isAllowedTab(5)).toBe(true);
  });

  it("refuses a tab on any other host", async () => {
    const { host } = makeHost();
    tabsGet = async () => ({ url: "https://bank.example/transfer" });
    expect(await host.isAllowedTab(5)).toBe(false);
  });

  it("refuses a tab with no url, and a tab that cannot be read", async () => {
    const { host } = makeHost();
    tabsGet = async () => ({});
    expect(await host.isAllowedTab(5)).toBe(false);
    tabsGet = async () => {
      throw new Error("no such tab");
    };
    expect(await host.isAllowedTab(5)).toBe(false);
  });
});

describe("pageact host — running a batch", () => {
  it("forwards a validated batch to the content script", async () => {
    const { host } = makeHost();
    let sent: unknown = null;
    tabsSend = async (_tabId, message) => {
      sent = message;
      return { ok: true, results: [{ ok: true }] };
    };
    const outcome = await host.run(5, [{ kind: "click", selector: "#x" }]);
    expect(outcome.ok).toBe(true);
    expect(outcome.results).toHaveLength(1);
    expect(sent).toMatchObject({ kind: "webos/pageact.run" });
  });

  it("never touches a tab outside the allowlist", async () => {
    const { host } = makeHost();
    tabsGet = async () => ({ url: "https://bank.example/transfer" });
    let called = false;
    tabsSend = async () => {
      called = true;
      return { ok: true };
    };
    const outcome = await host.run(5, [{ kind: "click", selector: "#x" }]);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("白名单");
    expect(called).toBe(false);
  });

  it("refuses an invalid batch before it reaches the page", async () => {
    const { host } = makeHost();
    let called = false;
    tabsSend = async () => {
      called = true;
      return { ok: true };
    };
    const outcome = await host.run(5, [{ kind: "eval", code: "x" }]);
    expect(outcome.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("reports a page that does not answer", async () => {
    const { host } = makeHost();
    tabsSend = async () => {
      throw new Error("no receiving end");
    };
    const outcome = await host.run(5, [{ kind: "click", selector: "#x" }]);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("无法与页面通信");
  });
});

describe("pageact host — confirmation", () => {
  it("refuses immediately when no panel is connected", async () => {
    const { host, broadcast } = makeHost({ panel: false });
    const outcome = await host.requestConfirmation(confirmRequest());
    expect(outcome.approved).toBe(false);
    expect(outcome.outcome).toBe("no-ui");
    expect(broadcast).toHaveLength(0);
  });

  it("asks the panel and runs the action once the user allows it", async () => {
    const { host, broadcast } = makeHost();
    const pending = host.requestConfirmation(confirmRequest());
    expect(broadcast).toHaveLength(1);
    expect(broadcast[0]?.kind).toBe("webos/ui.pageact.confirm");
    expect(host.answer({ id: "req-1", approved: true })).toBe(true);
    const outcome = await pending;
    expect(outcome.approved).toBe(true);
    expect(outcome.outcome).toBe("approved");
  });

  it("stops when the user refuses", async () => {
    const { host } = makeHost();
    const pending = host.requestConfirmation(confirmRequest());
    host.answer({ id: "req-1", approved: false });
    const outcome = await pending;
    expect(outcome.approved).toBe(false);
    expect(outcome.outcome).toBe("refused");
  });

  it("ignores an answer for an unknown request", () => {
    const { host } = makeHost();
    expect(host.answer({ id: "never-asked", approved: true })).toBe(false);
  });

  it("lists the pending requests", async () => {
    const { host } = makeHost();
    void host.requestConfirmation(confirmRequest("a"));
    void host.requestConfirmation(confirmRequest("b"));
    expect(host.pending().map((r) => r.id)).toEqual(["a", "b"]);
    host.refuseAll();
    expect(host.pending()).toHaveLength(0);
  });
});
