import { extractCompletionMeta } from "@webos/shared";
import type { TapInstallOptions } from "./types.js";
import { injectSystemPrompt } from "./prompt-inject.js";

interface XhrState {
  method: string;
  url: string;
}

/**
 * Observe XMLHttpRequest without changing its behaviour. DeepSeek's web client
 * currently sends the completion request through XHR, so this is the primary
 * path for the sensor.
 */
export function installXhrTap(options: TapInstallOptions & { XHRClass?: typeof XMLHttpRequest }): () => void {
  const XhrClass = options.XHRClass ?? (typeof XMLHttpRequest !== "undefined" ? XMLHttpRequest : undefined);
  if (!XhrClass) return () => {};

  const proto = XhrClass.prototype as XMLHttpRequest & Record<string, unknown>;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  if (typeof originalOpen !== "function" || typeof originalSend !== "function") return () => {};

  proto.open = function patchedOpen(this: XMLHttpRequest, ...args: unknown[]): void {
    try {
      const method = String(args[0] ?? "GET");
      const url = String(args[1] ?? "");
      (this as unknown as { __webosXhr?: XhrState }).__webosXhr = { method, url };
    } catch {
      // ignore
    }
    return Reflect.apply(originalOpen, this, args) as void;
  } as typeof proto.open;

  proto.send = function patchedSend(this: XMLHttpRequest, ...args: unknown[]): void {
    const state = (this as unknown as { __webosXhr?: XhrState }).__webosXhr;
    let finalArgs = args;
    let injectionVersion: number | undefined;

    try {
      if (state) {
        const base = options.baseHref ?? (typeof location !== "undefined" ? location.href : "https://chat.deepseek.com/");
        const url = new URL(state.url, base);
        if (options.match(url)) {
          const pending = options.injector?.consume();
          if (pending) {
            const { rewritten, injected } = injectSystemPrompt(args[0], pending.prompt);
            if (injected) {
              injectionVersion = pending.version;
              finalArgs = args.slice();
              finalArgs[0] = rewritten;
            }
          }
        }
      }
    } catch {
      // A rewrite failure must never block the request.
    }

    try {
      if (state) {
        const base = options.baseHref ?? (typeof location !== "undefined" ? location.href : "https://chat.deepseek.com/");
        const url = new URL(state.url, base);
        if (options.match(url)) {
          const id = crypto.randomUUID();
          const body = finalArgs[0];
          const meta = extractCompletionMeta(typeof body === "string" ? body : undefined);
          options.onStart({
            requestId: id,
            transport: "xhr",
            endpoint: url.pathname,
            thinkingEnabled: meta.thinkingEnabled,
            ts: Date.now(),
            injectionVersion,
          });

          let lastLength = 0;
          let reportedType = false;

          const read = (): void => {
            try {
              const responseType = this.responseType;
              if (responseType !== "" && responseType !== "text") {
                if (!reportedType) {
                  reportedType = true;
                  options.onError(id, "unsupported-response-type", `Unsupported responseType: ${responseType}`, false);
                }
                return;
              }
              const text = this.responseText;
              if (typeof text !== "string") return;
              if (text.length < lastLength) lastLength = 0;
              if (text.length > lastLength) {
                const chunk = text.slice(lastLength);
                lastLength = text.length;
                if (chunk) options.onChunk(id, chunk);
              }
            } catch (error) {
              options.onError(id, "tap-error", error instanceof Error ? error.message : String(error), false);
            }
          };

          this.addEventListener("progress", read);
          this.addEventListener("readystatechange", read);
          this.addEventListener("abort", () => options.onEnd(id, "aborted"));
          this.addEventListener("error", () => options.onEnd(id, "error"));
          this.addEventListener("loadend", () => {
            read();
            options.onEnd(id, "transport-closed");
          });
        }
      }
    } catch {
      // Observation must never break the page.
    }

    return Reflect.apply(originalSend, this, finalArgs) as void;
  } as typeof proto.send;

  return () => {
    proto.open = originalOpen;
    proto.send = originalSend;
  };
}
