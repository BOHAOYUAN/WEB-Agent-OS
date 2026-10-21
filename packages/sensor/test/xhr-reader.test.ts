import { afterEach, describe, expect, it } from "vitest";
import { installXhrTap } from "../src/main/taps/xhr.js";
import type { TapStart } from "../src/main/taps/types.js";

class FakeXhr {
  readyState = 0;
  responseType = "";
  responseText = "";
  status = 0;
  private readonly listeners = new Map<string, Set<() => void>>();

  open(_method: string, _url: string): void {
    this.readyState = 1;
  }

  send(_body?: unknown): void {
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

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

let uninstall: (() => void) | null = null;

afterEach(() => {
  uninstall?.();
  uninstall = null;
});

function setup() {
  const starts: TapStart[] = [];
  const chunks: string[] = [];
  const ends: string[] = [];
  const errors: string[] = [];
  uninstall = installXhrTap({
    XHRClass: FakeXhr as unknown as typeof XMLHttpRequest,
    baseHref: "https://chat.deepseek.com/chat",
    match: (url) => url.pathname === "/api/v0/chat/completion",
    onStart: (start) => starts.push(start),
    onChunk: (_requestId, chunk) => chunks.push(chunk),
    onEnd: (_requestId, reason) => ends.push(reason),
    onError: (_requestId, code) => errors.push(code),
  });
  return { starts, chunks, ends, errors };
}

describe("installXhrTap", () => {
  it("captures incremental responseText without changing the request", () => {
    const { starts, chunks, ends } = setup();
    const xhr = new FakeXhr();
    xhr.open("POST", "/api/v0/chat/completion");
    xhr.send(JSON.stringify({ thinking_enabled: true }));

    expect(starts).toHaveLength(1);
    expect(starts[0]?.transport).toBe("xhr");
    expect(starts[0]?.thinkingEnabled).toBe(true);

    xhr.responseText = 'data: {"v":"a"}\n\n';
    xhr.emit("progress");
    xhr.responseText += 'data: {"v":"b"}\n\n';
    xhr.emit("progress");
    xhr.emit("loadend");

    expect(chunks.join("")).toBe('data: {"v":"a"}\n\ndata: {"v":"b"}\n\n');
    expect(ends).toContain("transport-closed");
  });

  it("ignores non-completion requests", () => {
    const { starts } = setup();
    const xhr = new FakeXhr();
    xhr.open("POST", "/api/v0/chat/create_pow_challenge");
    xhr.send("{}");
    xhr.emit("progress");
    expect(starts).toHaveLength(0);
  });

  it("reports an unsupported responseType instead of throwing", () => {
    const { starts, errors } = setup();
    const xhr = new FakeXhr();
    xhr.responseType = "arraybuffer";
    xhr.open("POST", "/api/v0/chat/completion");
    xhr.send("{}");
    xhr.emit("progress");
    expect(starts).toHaveLength(1);
    expect(errors).toEqual(["unsupported-response-type"]);
  });

  it("restores the original prototype methods", () => {
    const { starts } = setup();
    uninstall?.();
    uninstall = null;
    const xhr = new FakeXhr();
    xhr.open("POST", "/api/v0/chat/completion");
    xhr.send("{}");
    expect(starts).toHaveLength(0);
  });
});
