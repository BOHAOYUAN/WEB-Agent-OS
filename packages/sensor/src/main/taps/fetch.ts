import { extractCompletionMeta } from "@webos/shared";
import type { TapCallbacks, TapInstallOptions } from "./types.js";
import { injectSystemPrompt } from "./prompt-inject.js";

interface FetchScope {
  fetch: typeof fetch;
}

async function pump(response: Response, requestId: string, callbacks: TapCallbacks): Promise<void> {
  try {
    if (!response.body) {
      callbacks.onEnd(requestId, "transport-closed");
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const text = decoder.decode(value, { stream: true });
      if (text) callbacks.onChunk(requestId, text);
    }
    const tail = decoder.decode();
    if (tail) callbacks.onChunk(requestId, tail);
    callbacks.onEnd(requestId, "transport-closed");
  } catch (error) {
    callbacks.onError(requestId, "decode-error", error instanceof Error ? error.message : String(error), false);
    callbacks.onEnd(requestId, "error");
  }
}

/**
 * Observe fetch responses by reading a clone. The original response is returned
 * to the page untouched, so the UI keeps working even if the tap fails.
 */
export function installFetchTap(
  options: TapInstallOptions & { scope?: FetchScope },
): () => void {
  const scope = options.scope ?? (typeof window !== "undefined" ? (window as unknown as FetchScope) : undefined);
  if (!scope || typeof scope.fetch !== "function") return () => {};

  const originalFetch = scope.fetch;

  const patched: typeof fetch = function patchedFetch(
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    let finalInit = init;
    let injectionVersion: number | undefined;

    try {
      const base = options.baseHref ?? (typeof location !== "undefined" ? location.href : "https://chat.deepseek.com/");
      const rawUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      const url = new URL(rawUrl, base);
      if (options.match(url)) {
        const pending = options.injector?.peek();
        if (pending) {
          const { rewritten, injected } = injectSystemPrompt(init?.body, pending.context);
          if (injected) {
            injectionVersion = pending.version;
            options.injector?.consume(pending.version);
            finalInit = { ...(init ?? {}), body: rewritten as BodyInit };
          }
        }
      }
    } catch {
      // A rewrite failure must never block the request.
    }

    const promise = Reflect.apply(originalFetch, scope, [input, finalInit]) as Promise<Response>;

    try {
      const base = options.baseHref ?? (typeof location !== "undefined" ? location.href : "https://chat.deepseek.com/");
      const rawUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      const url = new URL(rawUrl, base);
      if (options.match(url)) {
        const id = crypto.randomUUID();
        const meta = extractCompletionMeta(init?.body);
        options.onStart({
          requestId: id,
          transport: "fetch",
          endpoint: url.pathname,
          thinkingEnabled: meta.thinkingEnabled,
          ts: Date.now(),
          injectionVersion,
        });

        promise.then(
          (response) => {
            let clone: Response;
            try {
              clone = response.clone();
            } catch (error) {
              options.onError(id, "tap-error", error instanceof Error ? error.message : String(error), false);
              options.onEnd(id, "error");
              return;
            }
            void pump(clone, id, options);
          },
          () => options.onEnd(id, "error"),
        );
      }
    } catch {
      // Observation must never break the page.
    }

    return promise;
  } as typeof fetch;

  try {
    scope.fetch = patched;
  } catch {
    return () => {};
  }

  return () => {
    scope.fetch = originalFetch;
  };
}
