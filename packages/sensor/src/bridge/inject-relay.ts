import { LIMITS } from "@webos/shared";
import type { BridgeToMainEnvelope, BridgeToMainMessage, SystemContext } from "@webos/shared";

export interface PendingInjection {
  version: number;
  context: SystemContext;
}

export type DisarmTarget = "persona" | "memory" | "all";

export interface InjectRelayOptions {
  nonce: string;
  /** Post an envelope into the MAIN world. Injectable for tests. */
  post?: (envelope: BridgeToMainEnvelope) => void;
  now?: () => number;
}

/**
 * Bridge-side holder for the pending system-context injection. It is the
 * authoritative store (page-level lifetime, survives service-worker
 * suspension), owns the version sequence, merges persona + memory into ONE
 * context, and pushes arm/disarm into MAIN world via postMessage.
 */
export class InjectRelay {
  private pending: PendingInjection | null = null;
  private expiresAt = 0;
  private seq = 0;
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

  /** Arm/merge a partial context. Provided fields overwrite, missing fields keep their current value. */
  arm(partial: SystemContext): void {
    const context: SystemContext = { ...this.pending?.context, ...partial };
    if (context.persona === undefined) delete context.persona;
    if (context.memory === undefined) delete context.memory;
    if (!context.persona && !context.memory) return;

    this.pending = { version: ++this.seq, context };
    this.expiresAt = this.now() + LIMITS.injectArmTtlMs;
    this.push({ kind: "webos/inject.arm", v: 1, version: this.pending.version, context });
    this.armTtl();
  }

  /** Remove one field. If nothing remains, fully disarm; otherwise re-push the reduced context. */
  disarm(target: DisarmTarget): void {
    if (!this.pending) return;

    if (target === "all") {
      this.pending = null;
      this.clearTtl();
      this.push({ kind: "webos/inject.disarm", v: 1 });
      return;
    }

    const context: SystemContext = { ...this.pending.context };
    delete context[target];
    if (!context.persona && !context.memory) {
      this.pending = null;
      this.clearTtl();
      this.push({ kind: "webos/inject.disarm", v: 1 });
      return;
    }

    this.pending = { version: ++this.seq, context };
    this.expiresAt = this.now() + LIMITS.injectArmTtlMs;
    this.push({ kind: "webos/inject.arm", v: 1, version: this.pending.version, context });
    this.armTtl();
  }

  /** Called when main reports it consumed an injection. */
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
      this.disarm("all");
      return;
    }
    this.push({ kind: "webos/inject.arm", v: 1, version: this.pending.version, context: this.pending.context });
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
      if (this.pending && this.now() >= this.expiresAt) this.disarm("all");
    }, LIMITS.injectArmTtlMs);
  }

  private clearTtl(): void {
    if (this.ttlTimer !== null) {
      clearTimeout(this.ttlTimer);
      this.ttlTimer = null;
    }
  }
}
