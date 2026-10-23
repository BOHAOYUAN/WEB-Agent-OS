import { describe, expect, it } from "vitest";
import type { PageActConfirmRequest } from "@webos/shared";
import { ConfirmRegistry, isApproved } from "../src/confirm.js";

const request = (id = "req-1"): PageActConfirmRequest => ({
  id,
  action: { kind: "click", selector: "#submit" },
  summary: "点击 #submit",
  danger: "submit",
  element: "button.submit",
});

describe("confirm registry — the user can allow a dangerous action", () => {
  it("resolves approved when the user says yes", async () => {
    const registry = new ConfirmRegistry();
    const pending = registry.request(request());
    expect(registry.answer({ id: "req-1", approved: true })).toBe(true);
    expect(await pending).toBe("approved");
  });

  it("resolves refused when the user says no", async () => {
    const registry = new ConfirmRegistry();
    const pending = registry.request(request());
    registry.answer({ id: "req-1", approved: false });
    expect(await pending).toBe("refused");
  });

  it("waits for the answer before resolving", async () => {
    const registry = new ConfirmRegistry();
    let settled = false;
    const pending = registry.request(request()).then((outcome) => {
      settled = true;
      return outcome;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    registry.answer({ id: "req-1", approved: true });
    await pending;
    expect(settled).toBe(true);
  });
});

describe("confirm registry — silence is never consent", () => {
  it("times out into a refusal", async () => {
    const registry = new ConfirmRegistry(10);
    expect(await registry.request(request())).toBe("timeout");
  });

  it("ignores an answer that arrives after the timeout", async () => {
    const registry = new ConfirmRegistry(10);
    const pending = registry.request(request());
    expect(await pending).toBe("timeout");
    // A late click must not revive an action that was already refused.
    expect(registry.answer({ id: "req-1", approved: true })).toBe(false);
  });

  it("ignores an answer for an unknown id", () => {
    const registry = new ConfirmRegistry();
    expect(registry.answer({ id: "never-asked", approved: true })).toBe(false);
  });

  it("refuses everything on teardown", async () => {
    const registry = new ConfirmRegistry();
    const first = registry.request(request("a"));
    const second = registry.request(request("b"));
    registry.refuseAll();
    expect(await first).toBe("refused");
    expect(await second).toBe("refused");
    expect(registry.size).toBe(0);
  });
});

describe("confirm registry — bookkeeping", () => {
  it("lists the pending requests", () => {
    const registry = new ConfirmRegistry();
    registry.request(request("a"));
    registry.request(request("b"));
    expect(registry.size).toBe(2);
    expect(registry.list().map((r) => r.id)).toEqual(["a", "b"]);
    registry.answer({ id: "a", approved: true });
    expect(registry.list().map((r) => r.id)).toEqual(["b"]);
  });

  it("only an explicit approval counts as consent", () => {
    expect(isApproved("approved")).toBe(true);
    expect(isApproved("refused")).toBe(false);
    expect(isApproved("timeout")).toBe(false);
    expect(isApproved("no-ui")).toBe(false);
  });
});
