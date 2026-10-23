/**
 * Pending confirmation registry.
 *
 * A dangerous action stops and waits for a human. This holds it until the
 * user answers, the timeout expires, or there is no UI to ask at all.
 *
 * The default is refusal in every direction: no UI listening → "no-ui",
 * nobody answering → "timeout", and only an explicit approval resolves
 * "approved". Nothing else can turn into consent.
 */

import type {
  ConfirmOutcome,
  PageActConfirmRequest,
  PageActConfirmResponse,
} from "@webos/shared";

/** How long a dangerous action waits for the user before it is refused. */
export const DEFAULT_CONFIRM_TIMEOUT_MS = 60_000;

interface Pending {
  request: PageActConfirmRequest;
  resolve: (outcome: ConfirmOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ConfirmRegistry {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly timeoutMs: number = DEFAULT_CONFIRM_TIMEOUT_MS) {}

  /**
   * Register a request and wait for the answer.
   *
   * Resolves "timeout" if nobody answers in time. The caller must treat
   * every outcome except "approved" as a refusal.
   */
  request(request: PageActConfirmRequest, timeoutMs: number = this.timeoutMs): Promise<ConfirmOutcome> {
    return new Promise<ConfirmOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        resolve("timeout");
      }, timeoutMs);
      this.pending.set(request.id, { request, resolve, timer });
    });
  }

  /**
   * Answer a pending request.
   *
   * Returns false when the id is unknown — the request already timed out, or
   * it was never asked. A late answer must not revive a refused action.
   */
  answer(response: PageActConfirmResponse): boolean {
    const entry = this.pending.get(response.id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(response.id);
    entry.resolve(response.approved ? "approved" : "refused");
    return true;
  }

  /** The requests still waiting — this is what the UI renders. */
  list(): PageActConfirmRequest[] {
    return [...this.pending.values()].map((entry) => entry.request);
  }

  /** How many requests are waiting. */
  get size(): number {
    return this.pending.size;
  }

  /**
   * Refuse everything (the side panel closed, the tab went away).
   *
   * Called on teardown so a pending dangerous action can never hang until
   * its timeout.
   */
  refuseAll(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve("refused");
    }
    this.pending.clear();
  }
}

/** Only an explicit approval counts as consent. */
export function isApproved(outcome: ConfirmOutcome): boolean {
  return outcome === "approved";
}
