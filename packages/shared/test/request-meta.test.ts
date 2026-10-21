import { describe, expect, it } from "vitest";
import { extractUserPrompt } from "../src/protocol/request-meta.js";

describe("extractUserPrompt", () => {
  it("returns the prompt string directly", () => {
    expect(extractUserPrompt(JSON.stringify({ prompt: "你好" }))).toBe("你好");
  });

  it("returns the last user message content from a messages array", () => {
    const body = JSON.stringify({
      messages: [
        { role: "user", content: "第一问" },
        { role: "assistant", content: "答" },
        { role: "user", content: "第二问" },
      ],
    });
    expect(extractUserPrompt(body)).toBe("第二问");
  });

  it("returns null for non-JSON", () => {
    expect(extractUserPrompt("{not json")).toBeNull();
  });

  it("returns null for a body without user content", () => {
    expect(extractUserPrompt(JSON.stringify({ messages: [{ role: "assistant", content: "答" }] }))).toBeNull();
  });

  it("returns null for an oversized prompt", () => {
    expect(extractUserPrompt(JSON.stringify({ prompt: "x".repeat(9000) }))).toBeNull();
  });

  it("returns null for a non-string body", () => {
    expect(extractUserPrompt(new URLSearchParams())).toBeNull();
  });

  it("returns null for a user message with non-string content", () => {
    expect(extractUserPrompt(JSON.stringify({ messages: [{ role: "user", content: { parts: ["x"] } }] }))).toBeNull();
  });
});
