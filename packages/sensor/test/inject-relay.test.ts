import { describe, expect, it, vi } from "vitest";
import { InjectRelay } from "../src/bridge/inject-relay.js";
import type { BridgeToMainEnvelope, BridgeToMainMessage } from "@webos/shared";

function makeRelay(now?: () => number) {
  const posted: BridgeToMainEnvelope[] = [];
  const relay = new InjectRelay({
    nonce: "n",
    now,
    post: (envelope) => posted.push(envelope),
  });
  return { relay, posted };
}

function armMessages(posted: BridgeToMainEnvelope[]): BridgeToMainMessage[] {
  return posted.filter((e) => e.message.kind === "webos/inject.arm").map((e) => e.message);
}

describe("InjectRelay", () => {
  it("merges persona then memory into one context with a fresh version", () => {
    const { relay, posted } = makeRelay();
    relay.arm({ persona: "p" });
    relay.arm({ memory: "m" });
    const arms = armMessages(posted);
    expect(arms).toHaveLength(2);
    expect(arms[1]).toMatchObject({ version: 2, context: { persona: "p", memory: "m" } });
    expect(relay.pendingInjection?.context).toEqual({ persona: "p", memory: "m" });
  });

  it("memory first then persona still merges (order independent)", () => {
    const { relay } = makeRelay();
    relay.arm({ memory: "m" });
    relay.arm({ persona: "p" });
    expect(relay.pendingInjection?.context).toEqual({ persona: "p", memory: "m" });
  });

  it("disarm(persona) keeps memory and re-arms with a new version", () => {
    const { relay, posted } = makeRelay();
    relay.arm({ persona: "p", memory: "m" });
    relay.disarm("persona");
    expect(relay.pendingInjection?.context).toEqual({ memory: "m" });
    const last = armMessages(posted).at(-1);
    expect(last).toMatchObject({ version: 2, context: { memory: "m" } });
  });

  it("disarm(memory) keeps persona", () => {
    const { relay } = makeRelay();
    relay.arm({ persona: "p", memory: "m" });
    relay.disarm("memory");
    expect(relay.pendingInjection?.context).toEqual({ persona: "p" });
  });

  it("disarm(all) fully disarms and pushes disarm", () => {
    const { relay, posted } = makeRelay();
    relay.arm({ persona: "p", memory: "m" });
    relay.disarm("all");
    expect(relay.pendingInjection).toBeNull();
    expect(posted.at(-1)?.message).toEqual({ kind: "webos/inject.disarm", v: 1 });
  });

  it("disarming the last remaining field fully disarms", () => {
    const { relay, posted } = makeRelay();
    relay.arm({ persona: "p" });
    relay.disarm("persona");
    expect(relay.pendingInjection).toBeNull();
    expect(posted.at(-1)?.message).toEqual({ kind: "webos/inject.disarm", v: 1 });
  });

  it("ack clears only on version match", () => {
    const { relay } = makeRelay();
    relay.arm({ persona: "p" });
    relay.ack(999);
    expect(relay.pendingInjection).not.toBeNull();
    relay.ack(1);
    expect(relay.pendingInjection).toBeNull();
  });

  it("rearm re-pushes the pending context with the same version", () => {
    const { relay, posted } = makeRelay();
    relay.arm({ persona: "p", memory: "m" });
    const before = armMessages(posted).length;
    relay.rearm();
    const arms = armMessages(posted);
    expect(arms).toHaveLength(before + 1);
    expect(arms.at(-1)).toMatchObject({ version: 1, context: { persona: "p", memory: "m" } });
  });

  it("rearm disarms after TTL expiry", () => {
    vi.useFakeTimers();
    try {
      let now = 1000;
      const posted: BridgeToMainEnvelope[] = [];
      const relay = new InjectRelay({
        nonce: "n",
        now: () => now,
        post: (envelope) => posted.push(envelope),
      });
      relay.arm({ persona: "p" });
      now = 1000 + 5 * 60 * 1000 + 1; // past the 5-minute TTL
      relay.rearm();
      expect(relay.pendingInjection).toBeNull();
      expect(posted.at(-1)?.message).toEqual({ kind: "webos/inject.disarm", v: 1 });
    } finally {
      vi.useRealTimers();
    }
  });
});
