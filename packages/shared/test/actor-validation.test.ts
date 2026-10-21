import { describe, expect, it } from "vitest";
import { validateActorCommand } from "../src/util/validation.js";

const MEMORY = { facts: [], preferences: [], decisions: [], open_loops: [], summary: "s" };

describe("validateActorCommand — memory-store", () => {
  it("accepts save with a valid memory + model", () => {
    const result = validateActorCommand({
      v: 2,
      id: "a",
      kind: "memory-store",
      action: "save",
      memory: MEMORY,
      model: "qwen2.5:3b",
      timeoutMs: 5000,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts get", () => {
    expect(validateActorCommand({ v: 2, id: "a", kind: "memory-store", action: "get", timeoutMs: 5000 }).ok).toBe(true);
  });

  it("accepts clear", () => {
    expect(validateActorCommand({ v: 2, id: "a", kind: "memory-store", action: "clear", timeoutMs: 5000 }).ok).toBe(true);
  });

  it("rejects save with an invalid memory", () => {
    const result = validateActorCommand({
      v: 2,
      id: "a",
      kind: "memory-store",
      action: "save",
      memory: "nope",
      model: "qwen2.5:3b",
      timeoutMs: 5000,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects save with a missing model", () => {
    const result = validateActorCommand({
      v: 2,
      id: "a",
      kind: "memory-store",
      action: "save",
      memory: MEMORY,
      timeoutMs: 5000,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects save with an invalid source", () => {
    const result = validateActorCommand({
      v: 2,
      id: "a",
      kind: "memory-store",
      action: "save",
      memory: MEMORY,
      model: "qwen2.5:3b",
      source: "not-a-source",
      timeoutMs: 5000,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown action", () => {
    const result = validateActorCommand({ v: 2, id: "a", kind: "memory-store", action: "delete", timeoutMs: 5000 });
    expect(result.ok).toBe(false);
  });

  it("rejects a timeout out of range", () => {
    expect(validateActorCommand({ v: 2, id: "a", kind: "memory-store", action: "get", timeoutMs: 10 }).ok).toBe(false);
  });
});
