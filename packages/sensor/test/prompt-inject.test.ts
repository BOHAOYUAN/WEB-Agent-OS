import { describe, expect, it } from "vitest";
import { composeSystemContext, injectSystemPrompt } from "../src/main/taps/prompt-inject.js";

const PROMPT = "You are a senior software engineer.";
const MEMORY = "用户偏好简洁回复。";

describe("composeSystemContext", () => {
  it("puts memory before persona", () => {
    expect(composeSystemContext({ persona: PROMPT, memory: MEMORY })).toBe(`${MEMORY}\n\n---\n\n${PROMPT}`);
  });

  it("returns only the provided field", () => {
    expect(composeSystemContext({ persona: PROMPT })).toBe(PROMPT);
    expect(composeSystemContext({ memory: MEMORY })).toBe(MEMORY);
  });

  it("returns an empty string for an empty context", () => {
    expect(composeSystemContext({})).toBe("");
    expect(composeSystemContext({ persona: "   " })).toBe("");
  });
});

describe("injectSystemPrompt", () => {
  it("appends a composed system message and preserves other fields", () => {
    const body = JSON.stringify({
      messages: [{ role: "user", content: "帮我写代码" }],
      thinking_enabled: true,
      search_enabled: false,
      chat_session_id: "abc-123",
    });
    const { rewritten, injected } = injectSystemPrompt(body, { persona: PROMPT, memory: MEMORY });
    expect(injected).toBe(true);
    const parsed = JSON.parse(rewritten as string) as Record<string, unknown>;
    expect(parsed.thinking_enabled).toBe(true);
    expect(parsed.search_enabled).toBe(false);
    expect(parsed.chat_session_id).toBe("abc-123");
    const messages = parsed.messages as Array<Record<string, unknown>>;
    expect(messages.length).toBe(2);
    expect(messages[1]).toEqual({ role: "system", content: composeSystemContext({ persona: PROMPT, memory: MEMORY }) });
  });

  it("returns the original body when body is not a JSON string", () => {
    const body = new URLSearchParams({ q: "x" });
    const { rewritten, injected } = injectSystemPrompt(body, { persona: PROMPT });
    expect(injected).toBe(false);
    expect(rewritten).toBe(body);
  });

  it("returns the original body on malformed JSON", () => {
    const body = "{not json";
    const { rewritten, injected } = injectSystemPrompt(body, { persona: PROMPT });
    expect(injected).toBe(false);
    expect(rewritten).toBe(body);
  });

  it("returns the original body when messages is not an array", () => {
    const body = JSON.stringify({ messages: "nope" });
    const { rewritten, injected } = injectSystemPrompt(body, { persona: PROMPT });
    expect(injected).toBe(false);
    expect(rewritten).toBe(body);
  });

  it("returns the original body when the context is empty", () => {
    const body = JSON.stringify({ messages: [{ role: "user", content: "hi" }] });
    const { rewritten, injected } = injectSystemPrompt(body, {});
    expect(injected).toBe(false);
    expect(rewritten).toBe(body);
  });

  it("is idempotent when the trailing message is the same prompt", () => {
    const composed = composeSystemContext({ persona: PROMPT });
    const body = JSON.stringify({ messages: [{ role: "system", content: composed }] });
    const { rewritten, injected } = injectSystemPrompt(body, { persona: PROMPT });
    expect(injected).toBe(false);
    expect(rewritten).toBe(body);
  });

  it("does not mutate the original object", () => {
    const original = { messages: [{ role: "user", content: "hi" }] };
    const snapshot = JSON.stringify(original);
    injectSystemPrompt(JSON.stringify(original), { persona: PROMPT });
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("does not leak headers or credentials into the rewrite", () => {
    const body = JSON.stringify({ messages: [{ role: "user", content: "hi" }] });
    const { rewritten, injected } = injectSystemPrompt(body, { persona: PROMPT });
    expect(injected).toBe(true);
    const text = rewritten as string;
    expect(text).not.toContain("Authorization");
    expect(text).not.toContain("x-ds-pow");
    expect(text).not.toContain("cookie");
  });

  it("prepends the composed prompt to a web-style prompt string body", () => {
    const body = JSON.stringify({
      chat_session_id: "abc-123",
      prompt: "用 Python 写快速排序",
      parent_message_id: 1,
      thinking_enabled: true,
      search_enabled: false,
    });
    const { rewritten, injected } = injectSystemPrompt(body, { persona: PROMPT, memory: MEMORY });
    expect(injected).toBe(true);
    const parsed = JSON.parse(rewritten as string) as Record<string, unknown>;
    expect(parsed.chat_session_id).toBe("abc-123");
    expect(parsed.parent_message_id).toBe(1);
    expect(parsed.thinking_enabled).toBe(true);
    expect(parsed.prompt).toBe(composeSystemContext({ persona: PROMPT, memory: MEMORY }) + "\n\n---\n\n用 Python 写快速排序");
  });

  it("is idempotent for a web-style prompt that already contains the prompt", () => {
    const composed = composeSystemContext({ persona: PROMPT });
    const body = JSON.stringify({ prompt: `${composed}\n\n---\n\n用户输入` });
    const { rewritten, injected } = injectSystemPrompt(body, { persona: PROMPT });
    expect(injected).toBe(false);
    expect(rewritten).toBe(body);
  });

  it("returns the original body when neither messages nor prompt is present", () => {
    const body = JSON.stringify({ foo: "bar" });
    const { rewritten, injected } = injectSystemPrompt(body, { persona: PROMPT });
    expect(injected).toBe(false);
    expect(rewritten).toBe(body);
  });
});
