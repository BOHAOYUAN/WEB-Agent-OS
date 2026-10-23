/**
 * Token bucket — one per connection.
 *
 * Why the bridge needs it: the handshake token is REUSABLE, so a leaked token
 * is not a one-shot credential. Without a rate limit, one connection could
 * drive the bridge (and its `exec` allowlist) as fast as the socket allows,
 * and a buggy client could starve the real one.
 *
 * A token bucket rather than a fixed window: it allows a short burst (a panel
 * that sends three commands at once) while capping the sustained rate, and it
 * refills continuously instead of resetting on a boundary.
 *
 * The clock is injectable so the tests can drive time deterministically
 * instead of sleeping.
 */

export interface RateLimiterOptions {
  /** Sustained commands per second. */
  ratePerSecond?: number;
  /** Bucket size — how many commands may arrive at once. */
  burst?: number;
  /** Consecutive refusals before the connection is dropped. */
  maxViolations?: number;
  /** Injectable clock, in epoch milliseconds. */
  now?: () => number;
}

/**
 * Defaults are deliberately generous: the panel sends a handful of commands
 * over a session. The limit exists to stop a flood, not to police normal use.
 */
export const DEFAULT_RATE_PER_SECOND = 10;
export const DEFAULT_BURST = 20;
export const DEFAULT_MAX_VIOLATIONS = 5;

export class RateLimiter {
  private readonly ratePerSecond: number;
  private readonly burst: number;
  private readonly maxViolations: number;
  private readonly now: () => number;
  private tokens: number;
  private lastRefillMs: number;
  private violations = 0;

  constructor(options: RateLimiterOptions = {}) {
    this.ratePerSecond = options.ratePerSecond ?? DEFAULT_RATE_PER_SECOND;
    this.burst = options.burst ?? DEFAULT_BURST;
    this.maxViolations = options.maxViolations ?? DEFAULT_MAX_VIOLATIONS;
    this.now = options.now ?? (() => Date.now());
    this.tokens = this.burst;
    this.lastRefillMs = this.now();
  }

  /**
   * Try to spend one token.
   *
   * Returns false when the caller is over the limit. A refusal counts as a
   * violation; the next successful call resets the violation count, so only
   * a sustained flood trips the "drop the connection" threshold.
   */
  tryConsume(): boolean {
    this.refill();
    if (this.tokens < 1) {
      this.violations += 1;
      return false;
    }
    this.tokens -= 1;
    this.violations = 0;
    return true;
  }

  /** True once the connection has refused too many times in a row. */
  shouldDrop(): boolean {
    return this.violations >= this.maxViolations;
  }

  /** Consecutive refusals so far. */
  get violationCount(): number {
    return this.violations;
  }

  /** Tokens currently available (for diagnostics and tests). */
  get availableTokens(): number {
    this.refill();
    return this.tokens;
  }

  private refill(): void {
    const now = this.now();
    const elapsedMs = now - this.lastRefillMs;
    if (elapsedMs <= 0) return;
    this.lastRefillMs = now;
    this.tokens = Math.min(this.burst, this.tokens + (elapsedMs / 1000) * this.ratePerSecond);
  }
}
