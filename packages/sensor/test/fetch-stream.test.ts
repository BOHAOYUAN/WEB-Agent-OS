import { describe, expect, it } from "vitest";
import { installFetchTap } from "../src/main/taps/fetch.js";

const PAYLOAD = 'data: {"v":"你😀"}\n\ndata: {"v":"好"}\n\n';

function streamFromBytes(bytes: Uint8Array, chunkSize = 1): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < bytes.length; index += chunkSize) {
        controller.enqueue(bytes.slice(index, index + chunkSize));
      }
      controller.close();
    },
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timeout waiting for fetch tap");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("installFetchTap", () => {
  it("captures a cloned SSE stream and survives UTF-8 split across bytes", async () => {
    const bytes = new TextEncoder().encode(PAYLOAD);
    const chunks: string[] = [];
    const ends: string[] = [];
    const scope = {
      fetch: (async () => new Response(streamFromBytes(bytes), { headers: { "content-type": "text/event-stream" } })) as typeof fetch,
    };

    const uninstall = installFetchTap({
      scope,
      baseHref: "https://chat.deepseek.com/",
      match: (url) => url.pathname === "/api/v0/chat/completion",
      onStart: () => undefined,
      onChunk: (_requestId, chunk) => chunks.push(chunk),
      onEnd: (_requestId, reason) => ends.push(reason),
      onError: () => undefined,
    });

    try {
      await scope.fetch("/api/v0/chat/completion", {
        method: "POST",
        body: JSON.stringify({ thinking_enabled: false }),
      });
      await waitFor(() => ends.length > 0);
      expect(chunks.join("")).toBe(PAYLOAD);
      expect(ends[0]).toBe("transport-closed");
    } finally {
      uninstall();
    }
  });

  it("does not touch non-completion responses", async () => {
    let starts = 0;
    const scope = {
      fetch: (async () => new Response("ok")) as typeof fetch,
    };
    const uninstall = installFetchTap({
      scope,
      baseHref: "https://chat.deepseek.com/",
      match: (url) => url.pathname === "/api/v0/chat/completion",
      onStart: () => {
        starts += 1;
      },
      onChunk: () => undefined,
      onEnd: () => undefined,
      onError: () => undefined,
    });
    try {
      await scope.fetch("/api/v0/chat/session");
      expect(starts).toBe(0);
    } finally {
      uninstall();
    }
  });

  it("survives an uncloneable response", async () => {
    const errors: string[] = [];
    const ends: string[] = [];
    const scope = {
      fetch: (async () =>
        ({
          clone() {
            throw new Error("clone failed");
          },
        }) as unknown as Response) as typeof fetch,
    };
    const uninstall = installFetchTap({
      scope,
      baseHref: "https://chat.deepseek.com/",
      match: (url) => url.pathname === "/api/v0/chat/completion",
      onStart: () => undefined,
      onChunk: () => undefined,
      onEnd: (_requestId, reason) => ends.push(reason),
      onError: (_requestId, code) => errors.push(code),
    });
    try {
      await scope.fetch("/api/v0/chat/completion");
      await waitFor(() => ends.length > 0);
      expect(errors).toEqual(["tap-error"]);
      expect(ends).toEqual(["error"]);
    } finally {
      uninstall();
    }
  });
});
