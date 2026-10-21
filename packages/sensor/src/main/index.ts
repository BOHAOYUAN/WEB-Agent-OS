import { DEEPSEEK_COMPLETION_PATH } from "@webos/shared";
import { createChannel } from "./channel.js";
import { installFetchTap } from "./taps/fetch.js";
import { installXhrTap } from "./taps/xhr.js";
import type { TapInstallOptions } from "./taps/types.js";
import { createInjectorState } from "./injector-state.js";
import { installReverseChannel } from "./reverse-channel.js";

declare const __DEV__: boolean;

const INSTALLED_KEY = "__webosSensorMainInstalled__";

function boot(): void {
  const globalWindow = window as unknown as Record<string, unknown>;
  if (globalWindow[INSTALLED_KEY]) return;
  globalWindow[INSTALLED_KEY] = true;

  const channel = createChannel();
  const injector = createInjectorState();

  // Reverse channel: consume persona injections armed by the Router (via the
  // bridge). The nonce is shared with the bridge through the document dataset.
  const nonce = document.documentElement?.dataset.webosNonce ?? "";
  if (nonce) {
    installReverseChannel({ nonce }, {
      onArm: (version, context) => injector.arm(version, context),
      onDisarm: () => injector.disarm(),
    });
  }

  const callbacks: TapInstallOptions = {
    match: (url) => url.pathname === DEEPSEEK_COMPLETION_PATH,
    onStart: (start) => channel.start(start),
    onChunk: (requestId, chunk) => channel.chunk(requestId, chunk),
    onEnd: (requestId, reason) => channel.end(requestId, reason),
    onError: (requestId, code, message, fatal) => channel.tapError(requestId, code, message, fatal),
    injector,
  };

  installXhrTap(callbacks);
  installFetchTap({ ...callbacks, scope: window as unknown as { fetch: typeof fetch } });
  channel.ready();

  if (__DEV__) {
    console.debug("[webos-sensor] installed at", location.href);
  }
}

try {
  boot();
} catch {
  // A sensor failure must never affect the host page.
}
