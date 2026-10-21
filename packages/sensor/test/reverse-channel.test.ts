import { describe, expect, it, vi } from "vitest";
import { installReverseChannel } from "../src/main/reverse-channel.js";

interface FakeScope {
  handlers: Array<(event: MessageEvent<unknown>) => void>;
  addEventListener(type: string, handler: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: string, handler: (event: MessageEvent<unknown>) => void): void;
}

function makeScope(): FakeScope {
  const handlers: Array<(event: MessageEvent<unknown>) => void> = [];
  return {
    handlers,
    addEventListener(_type, handler) {
      handlers.push(handler);
    },
    removeEventListener(_type, handler) {
      const index = handlers.indexOf(handler);
      if (index >= 0) handlers.splice(index, 1);
    },
  };
}

const fakeWindow = {};
const fakeOrigin = "https://chat.deepseek.com";

function fire(scope: FakeScope, data: unknown): void {
  const event = { source: fakeWindow, origin: fakeOrigin, data } as MessageEvent<unknown>;
  for (const handler of scope.handlers) handler(event);
}

function setup() {
  const scope = makeScope();
  const onArm = vi.fn();
  const onDisarm = vi.fn();
  const onSetCapture = vi.fn();
  const uninstall = installReverseChannel(
    { nonce: "nonce-1", globals: { window: fakeWindow, location: { origin: fakeOrigin } }, scope },
    { onArm, onDisarm, onSetCapture },
  );
  return { scope, onArm, onDisarm, onSetCapture, uninstall };
}

describe("installReverseChannel", () => {
  it("dispatches a valid arm with a merged context", () => {
    const { scope, onArm, onDisarm } = setup();
    fire(scope, {
      source: "webos.sensor.bridge",
      v: 1,
      nonce: "nonce-1",
      message: { kind: "webos/inject.arm", v: 1, version: 7, context: { persona: "p", memory: "m" } },
    });
    expect(onArm).toHaveBeenCalledWith(7, { persona: "p", memory: "m" });
    expect(onDisarm).not.toHaveBeenCalled();
  });

  it("dispatches a valid disarm", () => {
    const { scope, onArm, onDisarm } = setup();
    fire(scope, { source: "webos.sensor.bridge", v: 1, nonce: "nonce-1", message: { kind: "webos/inject.disarm", v: 1 } });
    expect(onDisarm).toHaveBeenCalledOnce();
    expect(onArm).not.toHaveBeenCalled();
  });

  it("rejects a wrong nonce", () => {
    const { scope, onArm } = setup();
    fire(scope, {
      source: "webos.sensor.bridge",
      v: 1,
      nonce: "wrong",
      message: { kind: "webos/inject.arm", v: 1, version: 1, context: { persona: "p" } },
    });
    expect(onArm).not.toHaveBeenCalled();
  });

  it("rejects a wrong source", () => {
    const { scope, onArm } = setup();
    fire(scope, {
      source: "webos.sensor.main",
      v: 1,
      nonce: "nonce-1",
      message: { kind: "webos/inject.arm", v: 1, version: 1, context: { persona: "p" } },
    });
    expect(onArm).not.toHaveBeenCalled();
  });

  it("rejects an arm with an invalid context", () => {
    const { scope, onArm } = setup();
    fire(scope, {
      source: "webos.sensor.bridge",
      v: 1,
      nonce: "nonce-1",
      message: { kind: "webos/inject.arm", v: 1, version: 1, context: "not-an-object" },
    });
    expect(onArm).not.toHaveBeenCalled();
  });

  it("dispatches a valid set-capture", () => {
    const { scope, onSetCapture } = setup();
    fire(scope, {
      source: "webos.sensor.bridge",
      v: 1,
      nonce: "nonce-1",
      message: { kind: "webos/memory.set-capture", v: 1, enabled: true },
    });
    expect(onSetCapture).toHaveBeenCalledWith(true);
  });

  it("rejects a set-capture with a non-boolean enabled", () => {
    const { scope, onSetCapture } = setup();
    fire(scope, {
      source: "webos.sensor.bridge",
      v: 1,
      nonce: "nonce-1",
      message: { kind: "webos/memory.set-capture", v: 1, enabled: "yes" },
    });
    expect(onSetCapture).not.toHaveBeenCalled();
  });
});
