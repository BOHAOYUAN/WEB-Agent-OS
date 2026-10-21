import type { CaptureDumpResponse, UiMessage } from "@webos/shared";
import { mountDebugPanel } from "@webos/ui";

const root = document.getElementById("root");
if (!root) throw new Error("side panel root element is missing");

function sendRuntime<T>(message: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response: T) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

const panel = mountDebugPanel(root, {
  onDump: async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) return null;
      const response = await sendRuntime<CaptureDumpResponse>({ kind: "webos/capture.dump.request", tabId: tab.id });
      if (response.kind !== "webos/capture.dump.result" || !response.dump) return null;
      return response.dump;
    } catch {
      return null;
    }
  },
  onClear: () => {
    void sendRuntime({ kind: "webos/ui.clear" }).catch(() => undefined);
  },
  onToggleInject: (enabled) => {
    void sendRuntime({ kind: "webos/router.set-enabled", enabled }).catch(() => undefined);
  },
});

// Read the current injection flag from storage so the toggle reflects reality.
void sendRuntime<{ enabled?: boolean }>({ kind: "webos/router.get-enabled" })
  .then((state) => panel.setInjectEnabled(state.enabled === true))
  .catch(() => undefined);

let port: chrome.runtime.Port | null = null;

function connect(): void {
  try {
    const next = chrome.runtime.connect({ name: "webos:ui" });
    port = next;
    next.onMessage.addListener((message: unknown) => {
      panel.apply(message as UiMessage);
    });
    next.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connect, 500);
    });
    next.postMessage({ kind: "webos/ui.hello" });
  } catch {
    setTimeout(connect, 1000);
  }
}

connect();

window.addEventListener("unload", () => {
  try {
    port?.disconnect();
  } catch {
    // ignore
  }
});
