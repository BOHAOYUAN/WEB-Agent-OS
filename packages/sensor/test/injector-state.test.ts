import { describe, expect, it } from "vitest";
import { createInjectorState } from "../src/main/injector-state.js";

describe("createInjectorState", () => {
  it("arms then consumes exactly once", () => {
    const state = createInjectorState();
    state.arm(1, "prompt-a");
    expect(state.consume()).toEqual({ version: 1, prompt: "prompt-a" });
    expect(state.consume()).toBeNull();
  });

  it("disarm clears the pending injection", () => {
    const state = createInjectorState();
    state.arm(1, "prompt-a");
    state.disarm();
    expect(state.getPending()).toBeNull();
    expect(state.consume()).toBeNull();
  });

  it("ignores invalid arm payloads", () => {
    const state = createInjectorState();
    state.arm(1.5, "prompt-a");
    expect(state.getPending()).toBeNull();
    state.arm(2, "");
    expect(state.getPending()).toBeNull();
  });

  it("getPending is read-only and does not clear", () => {
    const state = createInjectorState();
    state.arm(3, "prompt-b");
    expect(state.getPending()).toEqual({ version: 3, prompt: "prompt-b" });
    expect(state.getPending()).toEqual({ version: 3, prompt: "prompt-b" });
  });
});
