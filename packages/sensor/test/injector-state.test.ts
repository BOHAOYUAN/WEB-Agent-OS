import { describe, expect, it } from "vitest";
import { createInjectorState } from "../src/main/injector-state.js";

describe("createInjectorState", () => {
  it("peeks then consumes exactly once", () => {
    const state = createInjectorState();
    state.arm(1, { persona: "persona-a" });
    expect(state.peek()).toEqual({ version: 1, context: { persona: "persona-a" } });
    state.consume(1);
    expect(state.peek()).toBeNull();
  });

  it("consume only clears when the version still matches", () => {
    const state = createInjectorState();
    state.arm(1, { persona: "persona-a" });
    state.consume(2); // stale version — must NOT clear
    expect(state.peek()).toEqual({ version: 1, context: { persona: "persona-a" } });
    state.consume(1);
    expect(state.peek()).toBeNull();
  });

  it("disarm clears the pending injection", () => {
    const state = createInjectorState();
    state.arm(1, { persona: "persona-a" });
    state.disarm();
    expect(state.getPending()).toBeNull();
    expect(state.peek()).toBeNull();
  });

  it("ignores invalid arm payloads", () => {
    const state = createInjectorState();
    state.arm(1.5, { persona: "persona-a" });
    expect(state.getPending()).toBeNull();
    state.arm(2, {});
    expect(state.getPending()).toBeNull();
  });

  it("stores a merged persona + memory context", () => {
    const state = createInjectorState();
    state.arm(3, { persona: "persona-b", memory: "memory-b" });
    expect(state.getPending()).toEqual({ version: 3, context: { persona: "persona-b", memory: "memory-b" } });
  });
});
