import type { SystemContext } from "@webos/shared";
import type { PromptInjector } from "./taps/types.js";

export interface PendingInjection {
  version: number;
  context: SystemContext;
}

/**
 * MAIN-world holder for a pending system-context injection (persona + memory
 * merged). The bridge arms a context; the next completion request peeks it,
 * injects the composed prompt, and only consumes (clears) it on a successful
 * rewrite — so a failed injection survives to retry on the next request, and a
 * context can never leak into a second turn.
 */
export function createInjectorState(): PromptInjector & {
  arm(version: number, context: SystemContext): void;
  disarm(): void;
  getPending(): PendingInjection | null;
} {
  let pending: PendingInjection | null = null;

  return {
    arm(version: number, context: SystemContext): void {
      if (!Number.isInteger(version) || !context) return;
      if (!context.persona && !context.memory) return;
      pending = { version, context };
    },
    disarm(): void {
      pending = null;
    },
    peek(): PendingInjection | null {
      return pending;
    },
    consume(version: number): void {
      // Only clear if the version still matches — a newer arm must not be lost.
      if (pending?.version === version) pending = null;
    },
    getPending(): PendingInjection | null {
      return pending;
    },
  };
}
