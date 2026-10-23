import { describe, expect, it } from "vitest";
import { readSandboxFeedback } from "../src/sandbox-frame.js";
import { ARTIFACT_FEEDBACK_CHANNEL, MAX_ARTIFACT_FEEDBACK_CHARS } from "@webos/shared";

/**
 * The regression guard for a real bug: the sandbox iframe has an opaque origin,
 * so `event.origin` is always the string "null" and an
 * `event.origin === location.origin` check drops EVERY message. Identity has to
 * come from `event.source` instead. These tests pin that behaviour.
 */

// Distinct object identities stand in for distinct WindowProxy references.
const trusted = {} as Window;
const impostor = {} as Window;

function event(source: unknown, data: unknown): { source: unknown; data: unknown } {
  return { source, data };
}

function validPayload(): unknown {
  return { artifactId: "artifact-0", label: "按钮", payload: "点击了 1 次", ts: 1 };
}

describe("readSandboxFeedback", () => {
  it("accepts a report from the trusted frame", () => {
    const result = readSandboxFeedback(
      event(trusted, { type: ARTIFACT_FEEDBACK_CHANNEL, payload: validPayload() }),
      trusted,
    );
    expect(result?.artifactId).toBe("artifact-0");
    expect(result?.payload).toBe("点击了 1 次");
    expect(result?.label).toBe("按钮");
  });

  it("rejects a message from any other window", () => {
    const result = readSandboxFeedback(
      event(impostor, { type: ARTIFACT_FEEDBACK_CHANNEL, payload: validPayload() }),
      trusted,
    );
    expect(result).toBeNull();
  });

  it("rejects everything before the frame has loaded (trusted is null)", () => {
    // Guard against an about:blank frame talking to us during startup.
    const result = readSandboxFeedback(
      event(trusted, { type: ARTIFACT_FEEDBACK_CHANNEL, payload: validPayload() }),
      null,
    );
    expect(result).toBeNull();
  });

  it("rejects a message on a different channel", () => {
    const result = readSandboxFeedback(
      event(trusted, { type: "webos/artifact.render", payload: validPayload() }),
      trusted,
    );
    expect(result).toBeNull();
  });

  it("rejects a message with no type at all", () => {
    expect(readSandboxFeedback(event(trusted, { payload: validPayload() }), trusted)).toBeNull();
    expect(readSandboxFeedback(event(trusted, null), trusted)).toBeNull();
    expect(readSandboxFeedback(event(trusted, "a string"), trusted)).toBeNull();
  });

  it("rejects a well-typed message with a malformed payload", () => {
    for (const payload of [
      null,
      "nope",
      { payload: "x", ts: 1 }, // missing artifactId
      { artifactId: "a", ts: 1 }, // missing payload
      { artifactId: "", payload: "x", ts: 1 }, // empty id
    ]) {
      expect(readSandboxFeedback(event(trusted, { type: ARTIFACT_FEEDBACK_CHANNEL, payload }), trusted)).toBeNull();
    }
  });

  it("caps an oversized payload rather than passing it through", () => {
    const result = readSandboxFeedback(
      event(trusted, {
        type: ARTIFACT_FEEDBACK_CHANNEL,
        payload: { artifactId: "artifact-0", payload: "x".repeat(MAX_ARTIFACT_FEEDBACK_CHARS + 900), ts: 1 },
      }),
      trusted,
    );
    expect(result?.payload).toHaveLength(MAX_ARTIFACT_FEEDBACK_CHARS);
  });
});
