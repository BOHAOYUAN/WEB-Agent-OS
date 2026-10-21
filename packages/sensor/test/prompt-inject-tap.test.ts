import { afterEach, describe, expect, it, vi } from "vitest";
import { installXhrTap } from "../src/main/taps/xhr.js";
import type { TapStart } from "../src/main/taps/types.js";

class RecordingXhr {
  readyState = 0;
  responseType = "";
  responseText = "";
  status = 0;
  sentBody: unknown = undefined;
  private readonly listeners = new Map<string, Set<() => void>>();

  open(_method: string, _url: string): void {
    this.readyState = 1;
  }

  send(body?: unknown): void {
    this.sentBody = body;
    this.readyState = 2;
  }

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
}

let uninstall: (() => void) | null = null;

afterEach(() => {
  uninstall?.();
  uninstall = null;
});

interface FakeInjector {
  peek: () => { version: number; context: { persona?: string; memory?: string } } | null;
  consume: (version: number) => void;
}

function setup(injector?: FakeInjector) {
  const starts: TapStart[] = [];
  uninstall = installXhrTap({
    XHRClass: RecordingXhr as unknown as typeof XMLHttpRequest,
    baseHref: "https://chat.deepseek.com/chat",
    match: (url) => url.pathname === "/api/v0/chat/completion",
    onStart: (start) => starts.push(start),
    onChunk: () => {},
    onEnd: () => {},
    onError: () => {},
    injector,
  });
  return { starts };
}

describe("installXhrTap injection", () => {
  it("rewrites the body and consumes when an injection is armed", () => {
    const consume = vi.fn();
    const injector: FakeInjector = {
      peek: () => ({ version: 1, context: { persona: "You are a coder." } }),
      consume,
    };
    const { starts } = setup(injector);
    const xhr = new RecordingXhr();
    xhr.open("POST", "/api/v0/chat/completion");
    xhr.send(JSON.stringify({ messages: [{ role: "user", content: "hi" }] }));

    const parsed = JSON.parse(xhr.sentBody as string) as { messages: Array<Record<string, unknown>> };
    expect(parsed.messages.at(-1)).toEqual({ role: "system", content: "You are a coder." });
    expect(starts[0]?.injectionVersion).toBe(1);
    expect(consume).toHaveBeenCalledWith(1);
  });

  it("does not consume when injection fails", () => {
    const consume = vi.fn();
    const injector: FakeInjector = {
      peek: () => ({ version: 2, context: { persona: "You are a coder." } }),
      consume,
    };
    const { starts } = setup(injector);
    const xhr = new RecordingXhr();
    const body = new URLSearchParams({ q: "x" });
    xhr.open("POST", "/api/v0/chat/completion");
    xhr.send(body);
    expect(xhr.sentBody).toBe(body);
    expect(starts[0]?.injectionVersion).toBeUndefined();
    expect(consume).not.toHaveBeenCalled();
  });

  it("leaves the body unchanged when no injection is armed", () => {
    const injector: FakeInjector = { peek: () => null, consume: () => {} };
    const { starts } = setup(injector);
    const xhr = new RecordingXhr();
    const body = JSON.stringify({ messages: [{ role: "user", content: "hi" }] });
    xhr.open("POST", "/api/v0/chat/completion");
    xhr.send(body);
    expect(xhr.sentBody).toBe(body);
    expect(starts[0]?.injectionVersion).toBeUndefined();
  });
});
