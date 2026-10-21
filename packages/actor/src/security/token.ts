/**
 * One-shot handshake token generation and constant-time comparison.
 *
 * The local bridge listens on 127.0.0.1, so any process on the same machine
 * could connect. A fresh, single-use token generated at startup is the gate:
 * the extension must present it (via a side channel the user controls) before
 * the WebSocket is accepted. Comparison is constant-time to avoid leaking the
 * token through timing.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";

/** Length of the raw random token in bytes (48 bytes -> 64 base64url chars). */
const TOKEN_BYTES = 48;

/**
 * Generate a fresh, single-use handshake token. Encoded as unpadded base64url
 * so it survives JSON and query strings without escaping issues.
 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Compare a candidate token against the expected token in constant time.
 * Never throws on length mismatch; returns false instead of leaking length.
 */
export function tokenMatches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Minimal stateful holder for the single-use token. Once consumed (or cleared)
 * no further connection may authenticate with it.
 */
export class OneShotToken {
  private token: string | null;

  constructor(token: string) {
    this.token = token;
  }

  /** Verify a candidate; on success the token is consumed and cannot be reused. */
  consume(candidate: string): boolean {
    if (this.token === null) return false;
    if (!tokenMatches(candidate, this.token)) return false;
    this.token = null;
    return true;
  }

  /** Whether the token has already been consumed or cleared. */
  get consumed(): boolean {
    return this.token === null;
  }

  /** The current token value (for the user to copy into the extension). */
  current(): string | null {
    return this.token;
  }
}

const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_BASE_BACKOFF_MS = 100;
const DEFAULT_MAX_BACKOFF_MS = 5_000;

export interface ReusableTokenOptions {
  /** Consecutive failures before exponential backoff kicks in. */
  maxFailures?: number;
  /** Backoff starts here and doubles per extra failure. */
  baseBackoffMs?: number;
  /** Backoff ceiling, so a brute-force attacker can never lock the user out forever. */
  maxBackoffMs?: number;
}

/**
 * A process-lifetime handshake token that may be verified many times (unlike
 * `OneShotToken`), which is what the sidepanel's reconnect logic needs.
 *
 * Security posture: constant-time comparison, bound to 127.0.0.1, and a
 * per-token exponential backoff on repeated failures. The backoff is NOT a
 * global lockout — it decays automatically and a correct token resets the
 * counter, so an attacker spraying wrong tokens cannot permanently deny the
 * legitimate client.
 */
export class ReusableToken {
  private readonly token: string;
  private failures = 0;
  private lockedUntil = 0;
  private readonly maxFailures: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(token: string, options: ReusableTokenOptions = {}) {
    this.token = token;
    this.maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES;
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  }

  /** Verify a candidate. Returns false during backoff or on a mismatch. */
  verify(candidate: string): boolean {
    const now = Date.now();
    if (now < this.lockedUntil) return false;

    if (!tokenMatches(candidate, this.token)) {
      this.failures += 1;
      if (this.failures >= this.maxFailures) {
        const extra = this.failures - this.maxFailures;
        const backoff = Math.min(this.baseBackoffMs * 2 ** extra, this.maxBackoffMs);
        this.lockedUntil = now + backoff;
      }
      return false;
    }

    this.failures = 0;
    this.lockedUntil = 0;
    return true;
  }
}
