import { describe, expect, it } from "vitest";
import { ReusableToken, generateToken, OneShotToken, tokenMatches } from "../src/security/token.js";

describe("generateToken", () => {
  it("produces distinct, non-empty tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  it("uses unpadded base64url (no = or + or /)", () => {
    const token = generateToken();
    expect(token).not.toContain("=");
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
  });
});

describe("tokenMatches", () => {
  it("matches identical tokens", () => {
    expect(tokenMatches("abc", "abc")).toBe(true);
  });

  it("rejects different tokens", () => {
    expect(tokenMatches("abc", "abd")).toBe(false);
  });

  it("rejects different lengths without throwing", () => {
    expect(tokenMatches("abc", "abcd")).toBe(false);
    expect(tokenMatches("abcd", "abc")).toBe(false);
  });
});

describe("OneShotToken", () => {
  it("consumes the token on first success", () => {
    const token = new OneShotToken("secret");
    expect(token.consume("secret")).toBe(true);
    expect(token.consumed).toBe(true);
  });

  it("cannot be reused after consumption", () => {
    const token = new OneShotToken("secret");
    expect(token.consume("secret")).toBe(true);
    expect(token.consume("secret")).toBe(false);
  });

  it("rejects a wrong token without consuming", () => {
    const token = new OneShotToken("secret");
    expect(token.consume("wrong")).toBe(false);
    expect(token.consumed).toBe(false);
    expect(token.consume("secret")).toBe(true);
  });
});

describe("ReusableToken", () => {
  it("verifies the same token repeatedly", () => {
    const token = new ReusableToken("secret");
    expect(token.verify("secret")).toBe(true);
    expect(token.verify("secret")).toBe(true);
    expect(token.verify("secret")).toBe(true);
  });

  it("rejects wrong tokens without consuming", () => {
    const token = new ReusableToken("secret");
    expect(token.verify("wrong")).toBe(false);
    expect(token.verify("secret")).toBe(true);
  });

  it("backs off after repeated failures, then recovers on a correct token", () => {
    const token = new ReusableToken("secret", { maxFailures: 3, baseBackoffMs: 50, maxBackoffMs: 1000 });
    expect(token.verify("wrong")).toBe(false);
    expect(token.verify("wrong")).toBe(false);
    expect(token.verify("wrong")).toBe(false);
    // Locked during backoff: even the correct token is refused.
    expect(token.verify("secret")).toBe(false);
  });

  it("resets the failure counter on a correct token", () => {
    const token = new ReusableToken("secret", { maxFailures: 3, baseBackoffMs: 50 });
    expect(token.verify("wrong")).toBe(false);
    expect(token.verify("wrong")).toBe(false);
    expect(token.verify("secret")).toBe(true);
    // Counter reset: two more wrongs won't trip the lock.
    expect(token.verify("wrong")).toBe(false);
    expect(token.verify("wrong")).toBe(false);
    expect(token.verify("secret")).toBe(true);
  });
});
