import type { PromptInjector } from "./taps/types.js";

export interface PendingInjection {
  version: number;
  prompt: string;
}

/**
 * MAIN-world holder for a pending persona injection. The bridge arms a
 * prompt; the next completion request consumes it exactly once (consume()
 * clears it), so a persona can never leak into a second turn.
 */
export function createInjectorState(): PromptInjector & {
  arm(version: number, prompt: string): void;
  disarm(): void;
  getPending(): PendingInjection | null;
} {
  let pending: PendingInjection | null = null;

  return {
    arm(version: number, prompt: string): void {
      if (!Number.isInteger(version) || !prompt) return;
      pending = { version, prompt };
    },
    disarm(): void {
      pending = null;
    },
    consume(): PendingInjection | null {
      const current = pending;
      pending = null;
      return current;
    },
    getPending(): PendingInjection | null {
      return pending;
    },
  };
}
