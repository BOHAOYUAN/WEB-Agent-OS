import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorResult } from "@webos/shared";
import { ACTOR_DEFAULT_PORT, ActorClient } from "../src/actor-client.js";

/** Minimal WebSocket stand-in so the client can be tested in Node. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  serverOpen(): void {
    this.onopen?.();
  }

  serverMessage(data: unknown): void {
    this.onmessage?.({ data });
  }

  serverClose(): void {
    this.onclose?.();
  }
}

const memoryResult = (id: string): ActorResult => ({
  v: 2,
  id,
  ok: true,
  kind: "memory-summary",
  memory: { facts: [], preferences: [], decisions: [], open_loops: [], summary: "s" },
  model: "qwen2.5:3b",
  elapsedMs: 5,
});

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ActorClient", () => {
  it("dials only ws://127.0.0.1:<port> with the token in the query", () => {
    const client = new ActorClient({ token: "secret", port: 4320 });
    expect(client.url()).toBe("ws://127.0.0.1:4320/?token=secret");
    expect(client.url()).toContain("127.0.0.1");
    expect(client.url()).not.toMatch(/wss?:\/\/(?!127\.0\.0\.1)/);
  });

  it("defaults to the configured Actor port", () => {
    const client = new ActorClient({ token: "secret" });
    expect(client.url()).toBe(`ws://127.0.0.1:${ACTOR_DEFAULT_PORT}/?token=secret`);
  });

  it("transitions connecting -> connected on open", () => {
    const states: string[] = [];
    const client = new ActorClient({ token: "s", onStateChange: (state) => states.push(state) });
    client.connect();
    expect(states).toEqual(["connecting"]);
    expect(client.connectionState).toBe("connecting");

    FakeWebSocket.instances[0]!.serverOpen();
    expect(states).toEqual(["connecting", "connected"]);
    expect(client.connectionState).toBe("connected");
  });

  it("matches a response to its command by id", async () => {
    const client = new ActorClient({ token: "s" });
    client.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.serverOpen();

    const promise = client.send({ v: 2, id: "c1", kind: "memory-summary", transcript: "hi", timeoutMs: 1000 });
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0]!).id).toBe("c1");

    const result = memoryResult("c1");
    ws.serverMessage(JSON.stringify(result));
    await expect(promise).resolves.toEqual(result);
  });

  it("ignores a response whose id has no pending command", () => {
    const client = new ActorClient({ token: "s" });
    client.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.serverOpen();
    expect(() => ws.serverMessage(JSON.stringify(memoryResult("unknown")))).not.toThrow();
  });

  it("rejects a command on timeout", async () => {
    vi.useFakeTimers();
    const client = new ActorClient({ token: "s", timeoutMs: 1000 });
    client.connect();
    FakeWebSocket.instances[0]!.serverOpen();

    const promise = client.send({ v: 2, id: "c2", kind: "memory-summary", transcript: "hi", timeoutMs: 1000 });
    const assertion = expect(promise).rejects.toThrow("命令超时");
    vi.advanceTimersByTime(1001);
    await assertion;
    vi.useRealTimers();
  });

  it("rejects send when not connected", async () => {
    const client = new ActorClient({ token: "s" });
    await expect(
      client.send({ v: 2, id: "c3", kind: "memory-summary", transcript: "hi", timeoutMs: 1000 }),
    ).rejects.toThrow("未连接 Actor");
  });

  it("rejects pending commands when the connection drops", async () => {
    const client = new ActorClient({ token: "s" });
    client.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.serverOpen();

    const promise = client.send({ v: 2, id: "c4", kind: "memory-summary", transcript: "hi", timeoutMs: 1000 });
    const assertion = expect(promise).rejects.toThrow("连接已断开");
    ws.serverClose();
    await assertion;
    expect(client.connectionState).toBe("disconnected");
  });

  it("disconnects cleanly and detaches handlers", () => {
    const client = new ActorClient({ token: "s" });
    client.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.serverOpen();
    client.disconnect();
    expect(ws.closed).toBe(true);
    expect(ws.onopen).toBeNull();
    expect(client.connectionState).toBe("disconnected");
  });
});
