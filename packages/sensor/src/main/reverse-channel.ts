import { isBridgeToMainEnvelope, isInjectArmMessage } from "@webos/shared";
import type { BridgeToMainMessage, SystemContext } from "@webos/shared";

export interface ReverseChannelHandlers {
  onArm(version: number, context: SystemContext): void;
  onDisarm(): void;
}

export interface ReverseChannelScope {
  addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: string, listener: (event: MessageEvent<unknown>) => void): void;
}

export interface ReverseChannelOptions {
  nonce: string;
  /** The global to compare event.source / event.origin against. Injectable for tests. */
  globals?: { window: unknown; location: { origin: string } };
  scope?: ReverseChannelScope;
}

/**
 * MAIN-world listener for the bridge -> main reverse channel. It validates the
 * envelope (source / origin / nonce) before dispatching, mirroring the bridge's
 * validation of main messages. Never throws into the host page.
 */
export function installReverseChannel(options: ReverseChannelOptions, handlers: ReverseChannelHandlers): () => void {
  const globals = options.globals ?? {
    window: typeof window !== "undefined" ? window : undefined,
    location: typeof location !== "undefined" ? location : { origin: "" },
  };
  const scope = options.scope ?? (window as unknown as ReverseChannelScope);
  const nonce = options.nonce;

  const listener = (event: MessageEvent<unknown>): void => {
    try {
      if (event.source !== globals.window || event.origin !== globals.location.origin) return;
      if (!isBridgeToMainEnvelope(event.data) || event.data.nonce !== nonce) return;
      const message = event.data.message as BridgeToMainMessage;
      if (!isInjectArmMessage(message)) return;
      if (message.kind === "webos/inject.arm") {
        handlers.onArm(message.version, message.context);
      } else {
        handlers.onDisarm();
      }
    } catch {
      // Never break the page on a malformed message.
    }
  };

  scope.addEventListener("message", listener);
  return () => scope.removeEventListener("message", listener);
}
