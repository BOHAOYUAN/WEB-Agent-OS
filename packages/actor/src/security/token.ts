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
