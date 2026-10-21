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

interface CaptureOptions {
  captureEnabled?: boolean;
  injector?: {
    peek: () => { version: number; context: { persona?: string; memory?: string } } | null;
    consume: (version: number) => void;
  };
}

function setup(options: CaptureOptions = {}) {
  const starts: TapStart[] = [];
  const userPrompts: Array<{ requestId: string; text: string }> = [];
  uninstall = installXhrTap({
    XHRClass: RecordingXhr as unknown as typeof XMLHttpRequest,
    baseHref: "https://chat.deepseek.com/chat",
    match: (url) => url.pathname === "/api/v0/chat/completion",
    onStart: (start) => starts.push(start),
    onChunk: () => {},
    onEnd: () => {},
    onError: () => {},
    onUserPrompt: (requestId, text) => userPrompts.push({ requestId, text }),
    injector: options.injector,
    memoryCapture: { enabled: options.captureEnabled ?? false },
  });
  return { starts, userPrompts };
}

describe("user prompt capture", () => {
  it("does not emit user prompts when capture is off", () => {
    const { userPrompts } = setup({ captureEnabled: false });
    const xhr = new RecordingXhr();
    xhr.open("POST", "/api/v0/chat/completion");
    xhr.send(JSON.stringify({ messages: [{ role: "user", content: "你好" }] }));
    expect(userPrompts).toHaveLength(0);
  });

  it("emits the user prompt with the same requestId as onStart", () => {
    const { starts, userPrompts } = setup({ captureEnabled: true });
    const xhr = new RecordingXhr();
    xhr.open("POST", "/api/v0/chat/completion");
    xhr.send(JSON.stringify({ messages: [{ role: "user", content: "你好" }] }));
    expect(userPrompts).toHaveLength(1);
    expect(userPrompts[0]?.text).toBe("你好");
    expect(userPrompts[0]?.requestId).toBe(starts[0]?.requestId);
  });

  it("captures the prompt string body shape", () => {
    const { userPrompts } = setup({ captureEnabled: true });
    const xhr = new RecordingXhr();
    xhr.open("POST", "/api/v0/chat/completion");
    xhr.send(JSON.stringify({ prompt: "用 Python 写快排" }));
    expect(userPrompts[0]?.text).toBe("用 Python 写快排");
  });

  it("captures the original user prompt even when injection rewrites the body", () => {
    const { userPrompts } = setup({
      captureEnabled: true,
      injector: { peek: () => ({ version: 1, context: { persona: "You are a coder." } }), consume: vi.fn() },
    });
    const xhr = new RecordingXhr();
    xhr.open("POST", "/api/v0/chat/completion");
    xhr.send(JSON.stringify({ messages: [{ role: "user", content: "你好" }] }));

    expect(userPrompts[0]?.text).toBe("你好");
    // The rewritten body must contain the injected system prompt, not the user text.
    const sent = JSON.parse(xhr.sentBody as string) as { messages: Array<Record<string, unknown>> };
    expect(sent.messages.at(-1)).toEqual({ role: "system", content: "You are a coder." });
  });
});
