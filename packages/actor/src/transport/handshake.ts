/**
 * WebSocket server handshake (RFC 6455 §4.2.2) — implemented from scratch.
 *
 * Computes the `Sec-WebSocket-Accept` value from the client's
 * `Sec-WebSocket-Key` using the fixed magic GUID, and validates the request's
 * `Origin` header against an allowlist before accepting the upgrade.
 */

import { createHash } from "node:crypto";

const WEBSOCKET_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/**
 * Compute the `Sec-WebSocket-Accept` response value for a given client key.
 * Pure function: SHA-1 of (key + magic GUID), base64-encoded.
 */
export function computeAccept(key: string): string {
  return createHash("sha1").update(key + WEBSOCKET_MAGIC).digest("base64");
}

export interface HandshakeRequest {
  method: string | undefined;
  headers: Readonly<Record<string, string | undefined>>;
  url: string | undefined;
}

export interface HandshakeResult {
  ok: boolean;
  /** The 101 switching-protocols response headers on success. */
  headers?: Record<string, string>;
  /** The reason to reject (sent as an HTTP error) on failure. */
  status?: number;
  reason?: string;
}

export interface HandshakeOptions {
  /** Origins allowed to connect. Empty array rejects everything. */
  allowedOrigins: readonly string[];
  /** Expected `Sec-WebSocket-Key` presence is enforced by default. */
  requireKey?: boolean;
}

/**
 * Validate an incoming HTTP upgrade request and, if accepted, produce the 101
 * response headers. Pure — takes parsed request data, returns headers; it does
 * not touch the socket.
 */
export function evaluateHandshake(
  request: HandshakeRequest,
  options: HandshakeOptions,
): HandshakeResult {
  if (request.method !== "GET") {
    return { ok: false, status: 405, reason: "method not allowed" };
  }

  const key = request.headers["sec-websocket-key"];
  if (options.requireKey !== false && !key) {
    return { ok: false, status: 400, reason: "missing Sec-WebSocket-Key" };
  }

  const upgrade = request.headers["upgrade"];
  if (!upgrade || upgrade.toLowerCase() !== "websocket") {
    return { ok: false, status: 400, reason: "invalid Upgrade header" };
  }

  const origin = request.headers["origin"];
  if (options.allowedOrigins.length === 0) {
    return { ok: false, status: 403, reason: "no origins allowed" };
  }
  // An absent Origin is only tolerated for non-browser clients; the extension
  // always sends one, so we require it when an allowlist is configured.
  if (!origin || !options.allowedOrigins.includes(origin)) {
    return { ok: false, status: 403, reason: "origin not allowed" };
  }

  if (!key) {
    return { ok: false, status: 400, reason: "missing Sec-WebSocket-Key" };
  }

  return {
    ok: true,
    headers: {
      Upgrade: "websocket",
      Connection: "Upgrade",
      "Sec-WebSocket-Accept": computeAccept(key),
    },
  };
}
