import { CHANNELS } from "@webos/shared";
import type { RouterDecision } from "@webos/router";
import type { SensorEvent } from "@webos/shared";
import { RuleRouter } from "@webos/router";

/**
 * Wires the pure RuleRouter to the MV3 service worker. It owns the Router
 * instance and the injection enable flag, feeds sensor events to the Router,
 * and translates "send-prompt" decisions into arm/disarm messages pushed to the
 * content bridge. This is the ONLY layer that couples Router to chrome APIs.
 */

interface RouterHostOptions {
  enabled?: boolean;
  sendArm: (tabId: number, pageSessionId: string, version: number, prompt: string) => void;
  sendDisarm: (tabId: number, pageSessionId: string) => void;
}

export class RouterHost {
  private readonly router: RuleRouter;
  private enabled: boolean;
  private injectSeq = 0;

  constructor(private readonly options: RouterHostOptions) {
    this.enabled = options.enabled ?? false;
    this.router = new RuleRouter({ enabled: this.enabled, injectGeneral: false });
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.router.setEnabled(enabled);
  }

  onSensorEvent(event: SensorEvent, tabId: number, pageSessionId: string): void {
    if (!this.enabled) return;
    const decision = this.router.onSensorEvent(event, { tabId, pageSessionId });
    this.applyDecision(decision, tabId, pageSessionId);
  }

  private applyDecision(decision: RouterDecision, tabId: number, pageSessionId: string): void {
    if (decision.kind === "send-prompt") {
      this.injectSeq += 1;
      this.options.sendArm(tabId, pageSessionId, this.injectSeq, decision.prompt);
    } else if (decision.kind === "stop") {
      this.options.sendDisarm(tabId, pageSessionId);
    }
  }
}

export function readRouterEnabled(defaultValue: boolean = false): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage.session.get(CHANNELS.routerStorageKey, (value) => {
        const stored = value?.[CHANNELS.routerStorageKey];
        resolve(typeof stored === "boolean" ? stored : defaultValue);
      });
    } catch {
      resolve(defaultValue);
    }
  });
}

export function writeRouterEnabled(enabled: boolean): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.storage.session.set({ [CHANNELS.routerStorageKey]: enabled }, () => resolve());
    } catch {
      resolve();
    }
  });
}
