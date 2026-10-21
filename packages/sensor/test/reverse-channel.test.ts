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
  const uninstall = installReverseChannel(
    { nonce: "nonce-1", globals: { window: fakeWindow, location: { origin: fakeOrigin } }, scope },
    { onArm, onDisarm },
  );
  return { scope, onArm, onDisarm, uninstall };
}

describe("installReverseChannel", () => {
  it("dispatches a valid arm", () => {
    const { scope, onArm, onDisarm } = setup();
    fire(scope, { source: "webos.sensor.bridge", v: 1, nonce: "nonce-1", message: { kind: "webos/inject.arm", v: 1, version: 7, prompt: "p" } });
    expect(onArm).toHaveBeenCalledWith(7, "p");
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
    fire(scope, { source: "webos.sensor.bridge", v: 1, nonce: "wrong", message: { kind: "webos/inject.arm", v: 1, version: 1, prompt: "p" } });
    expect(onArm).not.toHaveBeenCalled();
  });

  it("rejects a wrong source", () => {
    const { scope, onArm } = setup();
    fire(scope, { source: "webos.sensor.main", v: 1, nonce: "nonce-1", message: { kind: "webos/inject.arm", v: 1, version: 1, prompt: "p" } });
    expect(onArm).not.toHaveBeenCalled();
  });

  it("rejects an arm with an oversized prompt", () => {
    const { scope, onArm } = setup();
    fire(scope, {
      source: "webos.sensor.bridge",
      v: 1,
      nonce: "nonce-1",
      message: { kind: "webos/inject.arm", v: 1, version: 1, prompt: "x".repeat(5000) },
    });
    expect(onArm).not.toHaveBeenCalled();
  });
});
