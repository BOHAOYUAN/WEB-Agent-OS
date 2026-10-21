import { describe, expect, it } from "vitest";
import { bodyToMetaText, extractCompletionMeta } from "@webos/shared";

describe("extractCompletionMeta", () => {
  it("returns only the two allowed flags", () => {
    const body = JSON.stringify({
      prompt: "do not leak me",
      chat_session_id: "secret-session",
      thinking_enabled: true,
      search_enabled: false,
      ref_file_ids: ["secret-file"],
    });
    const meta = extractCompletionMeta(body);
    expect(meta).toEqual({ thinkingEnabled: true, searchEnabled: false });
    expect(Object.keys(meta).sort()).toEqual(["searchEnabled", "thinkingEnabled"]);
    expect(JSON.stringify(meta)).not.toContain("do not leak me");
    expect(JSON.stringify(meta)).not.toContain("secret-session");
  });

  it("defaults to thinking off for invalid bodies", () => {
    expect(extractCompletionMeta(undefined)).toEqual({ thinkingEnabled: false });
    expect(extractCompletionMeta("{not json")).toEqual({ thinkingEnabled: false });
    expect(extractCompletionMeta(JSON.stringify({ prompt: "x" }))).toEqual({ thinkingEnabled: false });
  });

  it("normalizes URLSearchParams bodies", () => {
    expect(bodyToMetaText(new URLSearchParams("thinking_enabled=true"))).toBe("thinking_enabled=true");
  });
});
