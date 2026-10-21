import { describe, expect, it } from "vitest";
import {
  computeAccept,
  evaluateHandshake,
} from "../src/transport/handshake.js";

describe("computeAccept", () => {
  it("matches the RFC 6455 example", () => {
    // RFC 6455 §1.3 shows dGhlIHNhbXBsZSBub25jZQ== -> s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
    expect(computeAccept("dGhlIHNhbXBsZSBub25jZQ==")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  });
});

describe("evaluateHandshake", () => {
  const baseRequest = {
    method: "GET",
    headers: {
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      upgrade: "websocket",
      origin: "chrome-extension://abcdef",
    },
    url: "/?token=xyz",
  };

  it("accepts a valid request from an allowed origin", () => {
    const result = evaluateHandshake(baseRequest, { allowedOrigins: ["chrome-extension://abcdef"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.headers?.["Sec-WebSocket-Accept"]).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    }
  });

  it("rejects a non-GET method", () => {
    const result = evaluateHandshake({ ...baseRequest, method: "POST" }, { allowedOrigins: ["chrome-extension://abcdef"] });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(405);
  });

  it("rejects a disallowed origin", () => {
    const result = evaluateHandshake({ ...baseRequest, headers: { ...baseRequest.headers, origin: "https://evil.example" } }, { allowedOrigins: ["chrome-extension://abcdef"] });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("rejects a missing origin", () => {
    const { origin: _omit, ...headers } = baseRequest.headers;
    const result = evaluateHandshake({ ...baseRequest, headers }, { allowedOrigins: ["chrome-extension://abcdef"] });
    expect(result.ok).toBe(false);
  });

  it("rejects a missing Sec-WebSocket-Key", () => {
    const { "sec-websocket-key": _omit, ...headers } = baseRequest.headers;
    const result = evaluateHandshake({ ...baseRequest, headers }, { allowedOrigins: ["chrome-extension://abcdef"] });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it("rejects when no origins are allowed", () => {
    const result = evaluateHandshake(baseRequest, { allowedOrigins: [] });
    expect(result.ok).toBe(false);
  });
});
