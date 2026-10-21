import { MAX_ITERATIONS } from "@webos/shared";

/**
 * Hard circuit-breaker against tool-call infinite loops ("套娃死循环").
 *
 * The Router tracks how many times it has emitted a prompt for a single
 * conversation turn. Once the count reaches MAX_ITERATIONS, it refuses to emit
 * more and instead returns an explicit stop decision. This is a pure, injectable
 * class so the limit and the clock can be faked in tests.
 */

export interface LoopGuardOptions {
  maxIterations?: number;
  now?: () => number;
}

export interface LoopGuardDecision {
  allowed: boolean;
  iterations: number;
  reason: "within-limit" | "max-iterations";
}

export class LoopGuard {
  private readonly maxIterations: number;
  private readonly now: () => number;
  /** Iterations observed for the current turn. Reset on stream.end. */
  private iterations = 0;

  constructor(options: LoopGuardOptions = {}) {
    this.maxIterations = options.maxIterations ?? MAX_ITERATIONS;
    this.now = options.now ?? (() => Date.now());
  }

  /** Record one prompt emission for the active turn and check the limit. */
  tryEmit(): LoopGuardDecision {
    this.iterations += 1;
    const within = this.iterations <= this.maxIterations;
    return {
      allowed: within,
      iterations: this.iterations,
      reason: within ? "within-limit" : "max-iterations",
    };
  }

  /** Reset the per-turn counter. Called when a stream ends or a turn changes. */
  reset(): void {
    this.iterations = 0;
  }

  get iterationsSeen(): number {
    return this.iterations;
  }

  get limit(): number {
    return this.maxIterations;
  }
}
