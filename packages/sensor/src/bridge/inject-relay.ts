import { LIMITS } from "@webos/shared";
import type { BridgeToMainEnvelope, BridgeToMainMessage } from "@webos/shared";

export interface PendingInjection {
  version: number;
  prompt: string;
}

export interface InjectRelayOptions {
  nonce: string;
  /** Post an envelope into the MAIN world. Injectable for tests. */
  post?: (envelope: BridgeToMainEnvelope) => void;
  now?: () => number;
}

/**
 * Bridge-side holder for a pending persona injection. It is the authoritative
 * store (page-level lifetime, survives service-worker suspension), and pushes
 * arm/disarm into MAIN world via postMessage.
 */
export class InjectRelay {
  private pending: PendingInjection | null = null;
  private expiresAt = 0;
  private readonly nonce: string;
  private readonly post: (envelope: BridgeToMainEnvelope) => void;
  private readonly now: () => number;
  private ttlTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: InjectRelayOptions) {
    this.nonce = options.nonce;
    this.now = options.now ?? (() => Date.now());
    this.post =
      options.post ??
      ((envelope) => {
        try {
          window.postMessage(envelope, location.origin);
        } catch {
          // Never break the page if the bridge is unavailable.
        }
      });
  }

  arm(version: number, prompt: string): void {
    this.pending = { version, prompt };
    this.expiresAt = this.now() + LIMITS.injectArmTtlMs;
    this.push({ kind: "webos/inject.arm", v: 1, version, prompt });
    this.armTtl();
  }

  disarm(): void {
    this.pending = null;
    this.clearTtl();
    this.push({ kind: "webos/inject.disarm", v: 1 });
  }

  /** Called when main reports it consumed (or attempted) an injection. */
  ack(version: number): void {
    if (this.pending?.version === version) {
      this.pending = null;
      this.clearTtl();
    }
  }

  /** Re-push the pending injection to main (e.g. after main re-mounts). */
  rearm(): void {
    if (!this.pending) return;
    if (this.now() >= this.expiresAt) {
      this.disarm();
      return;
    }
    this.push({ kind: "webos/inject.arm", v: 1, version: this.pending.version, prompt: this.pending.prompt });
  }

  get pendingInjection(): PendingInjection | null {
    return this.pending;
  }

  private push(message: BridgeToMainMessage): void {
    const envelope: BridgeToMainEnvelope = { source: "webos.sensor.bridge", v: 1, nonce: this.nonce, message };
    this.post(envelope);
  }

  private armTtl(): void {
    this.clearTtl();
    this.ttlTimer = setTimeout(() => {
      this.ttlTimer = null;
      if (this.pending && this.now() >= this.expiresAt) this.disarm();
    }, LIMITS.injectArmTtlMs);
  }

  private clearTtl(): void {
    if (this.ttlTimer !== null) {
      clearTimeout(this.ttlTimer);
      this.ttlTimer = null;
    }
  }
}
