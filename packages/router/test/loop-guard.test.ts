import { describe, expect, it } from "vitest";
import { LoopGuard } from "../src/loop-guard.js";

describe("LoopGuard", () => {
  it("allows up to maxIterations emissions", () => {
    const guard = new LoopGuard({ maxIterations: 3 });
    expect(guard.tryEmit().allowed).toBe(true);
    expect(guard.tryEmit().allowed).toBe(true);
    expect(guard.tryEmit().allowed).toBe(true);
    expect(guard.tryEmit().allowed).toBe(false);
  });

  it("reports max-iterations once the limit is exceeded", () => {
    const guard = new LoopGuard({ maxIterations: 1 });
    expect(guard.tryEmit()).toMatchObject({ allowed: true, iterations: 1 });
    expect(guard.tryEmit()).toMatchObject({ allowed: false, reason: "max-iterations" });
  });

  it("resets on demand", () => {
    const guard = new LoopGuard({ maxIterations: 1 });
    expect(guard.tryEmit().allowed).toBe(true);
    expect(guard.tryEmit().allowed).toBe(false);
    guard.reset();
    expect(guard.tryEmit().allowed).toBe(true);
  });
});
