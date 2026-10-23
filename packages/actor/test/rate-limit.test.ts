import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/security/rate-limit.js";

function clock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("rate limiter — token bucket", () => {
  it("allows a burst up to the bucket size and refuses the next one", () => {
    const limiter = new RateLimiter({ ratePerSecond: 1, burst: 3, now: () => 0 });
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);
  });

  it("refills continuously over time", () => {
    const c = clock();
    const limiter = new RateLimiter({ ratePerSecond: 2, burst: 2, now: c.now });
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);
    c.advance(500); // 2/s → one token back
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.tryConsume()).toBe(false);
  });

  it("never exceeds the burst, however long it was idle", () => {
    const c = clock();
    const limiter = new RateLimiter({ ratePerSecond: 10, burst: 5, now: c.now });
    c.advance(60_000);
    expect(limiter.availableTokens).toBe(5);
  });

  it("counts consecutive violations", () => {
    const c = clock();
    const limiter = new RateLimiter({ ratePerSecond: 1, burst: 1, maxViolations: 3, now: c.now });
    limiter.tryConsume(); // spends the only token
    limiter.tryConsume(); // violation 1
    limiter.tryConsume(); // violation 2
    expect(limiter.violationCount).toBe(2);
    expect(limiter.shouldDrop()).toBe(false);
    limiter.tryConsume(); // violation 3
    expect(limiter.shouldDrop()).toBe(true);
  });

  it("resets the violation count after a success", () => {
    const c = clock();
    const limiter = new RateLimiter({ ratePerSecond: 1, burst: 1, maxViolations: 3, now: c.now });
    limiter.tryConsume();
    limiter.tryConsume(); // violation 1
    expect(limiter.violationCount).toBe(1);
    c.advance(1000); // one token back
    expect(limiter.tryConsume()).toBe(true);
    expect(limiter.violationCount).toBe(0);
  });

  it("keeps one client's budget separate from another's", () => {
    const c = clock();
    const first = new RateLimiter({ ratePerSecond: 1, burst: 1, now: c.now });
    const second = new RateLimiter({ ratePerSecond: 1, burst: 1, now: c.now });
    expect(first.tryConsume()).toBe(true);
    expect(first.tryConsume()).toBe(false);
    expect(second.tryConsume()).toBe(true);
  });
});
