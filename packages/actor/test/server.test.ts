import { afterEach, describe, expect, it } from "vitest";
import { ACTOR_PROTOCOL_VERSION, type AuditRecord } from "@webos/shared";
import { createActorServer, type ActorServer } from "../src/transport/server.js";
import { generateToken } from "../src/security/token.js";
import { evaluateCommand } from "../src/security/command-policy.js";
import { connectClient } from "./ws-client.js";

let server: ActorServer | null = null;

afterEach(async () => {
  if (server) {
    await server.stop();
    server = null;
  }
});

/**
 * Drive an HTTP upgrade and return the status. A 101 comes back via the
 * "upgrade" event; any rejection (401/403) comes back via "response".
 */
async function upgradeStatus(port: number, token: string, origin?: string): Promise<number> {
  const http = await import("node:http");
  return new Promise<number>((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      method: "GET",
      path: `/?token=${token}`,
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
        ...(origin ? { Origin: origin } : {}),
      },
    });
    const timer = setTimeout(() => resolve(0), 3000);
    req.on("upgrade", (_res, socket) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(101);
    });
    req.on("response", (res) => {
      clearTimeout(timer);
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", () => {
      clearTimeout(timer);
      reject(new Error("request error"));
    });
    req.end();
  });
}

/**
 * Complete an upgrade, then reset the TCP connection (RST) without a clean
 * WebSocket close. Regression for the ECONNRESET crash that killed the Actor.
 */
async function resetAfterUpgrade(port: number, token: string): Promise<void> {
  const net = await import("node:net");
  return new Promise<void>((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(
        "GET /?token=" + encodeURIComponent(token) + " HTTP/1.1\r\n" +
        "Host: 127.0.0.1\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
        "Sec-WebSocket-Version: 13\r\n\r\n",
      );
    });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("reset handshake timeout"));
    }, 3000);
    socket.once("data", (chunk) => {
      clearTimeout(timer);
      if (!chunk.toString("utf8").includes("101")) {
        socket.destroy();
        reject(new Error("expected 101 before reset"));
        return;
      }
      socket.resetAndDestroy?.();
      socket.destroy();
      resolve();
    });
    socket.on("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
  });
}

describe("Actor server — upgrade (token-first + Origin-secondary)", () => {
  it("accepts no Origin with a correct token (101)", async () => {
    const token = generateToken();
    server = await createActorServer({ allowedOrigins: [], token, port: 0 });
    expect(await upgradeStatus(server.port, token)).toBe(101);
  });

  it("rejects an unknown Origin (403)", async () => {
    const token = generateToken();
    server = await createActorServer({ allowedOrigins: ["chrome-extension://abc"], token, port: 0 });
    expect(await upgradeStatus(server.port, token, "https://evil.example")).toBe(403);
  });

  it("accepts an allowlisted Origin (101)", async () => {
    const token = generateToken();
    server = await createActorServer({ allowedOrigins: ["chrome-extension://abc"], token, port: 0 });
    expect(await upgradeStatus(server.port, token, "chrome-extension://abc")).toBe(101);
  });

  it("rejects an Origin when no allowlist is configured (403)", async () => {
    const token = generateToken();
    server = await createActorServer({ allowedOrigins: [], token, port: 0 });
    expect(await upgradeStatus(server.port, token, "chrome-extension://abc")).toBe(403);
  });

  it("rejects a wrong token (401)", async () => {
    const token = generateToken();
    server = await createActorServer({ allowedOrigins: ["chrome-extension://abc"], token, port: 0 });
    expect(await upgradeStatus(server.port, "wrong", "chrome-extension://abc")).toBe(401);
  });

  it("reuses the token across multiple connections (101, 101)", async () => {
    const token = generateToken();
    server = await createActorServer({ allowedOrigins: ["chrome-extension://abc"], token, port: 0 });
    expect(await upgradeStatus(server.port, token, "chrome-extension://abc")).toBe(101);
    expect(await upgradeStatus(server.port, token, "chrome-extension://abc")).toBe(101);
  });

  it("survives a client TCP reset after upgrade", async () => {
    const token = generateToken();
    server = await createActorServer({ allowedOrigins: [], token, port: 0 });
    await resetAfterUpgrade(server.port, token);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await upgradeStatus(server.port, token)).toBe(101);
  });
});

describe("Actor server — command policy integration", () => {
  it("denies a dangerous command before any spawn", () => {
    expect(evaluateCommand("rm -rf /").ok).toBe(false);
    expect(evaluateCommand("git log $(whoami)").ok).toBe(false);
    expect(evaluateCommand("git log | grep foo").ok).toBe(false);
  });

  it("allows a safe allowlisted command", () => {
    expect(evaluateCommand("git status").ok).toBe(true);
  });
});

/** Ask the bridge for its audit trail over the real protocol. */
async function dumpAudit(port: number, token: string): Promise<AuditRecord[]> {
  const client = await connectClient(port, token);
  try {
    client.send(
      JSON.stringify({ v: ACTOR_PROTOCOL_VERSION, id: "audit-1", kind: "audit-dump", timeoutMs: 5000 }),
    );
    const raw = await client.next();
    const parsed = JSON.parse(raw) as { ok: boolean; kind?: string; records?: AuditRecord[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.kind).toBe("audit-dump");
    return parsed.records ?? [];
  } finally {
    client.close();
  }
}

describe("Actor server — audit trail", () => {
  it("records a refused handshake and a refused token", async () => {
    const token = generateToken();
    server = await createActorServer({ allowedOrigins: ["chrome-extension://abc"], token, port: 0 });
    await upgradeStatus(server.port, token, "https://evil.example");
    await upgradeStatus(server.port, "wrong", "chrome-extension://abc");
    const records = await dumpAudit(server.port, token);
    expect(records.some((r) => r.event === "handshake-denied")).toBe(true);
    expect(records.some((r) => r.event === "token-denied")).toBe(true);
  });

  it("never writes the token into the trail", async () => {
    const token = generateToken();
    server = await createActorServer({ allowedOrigins: [], token, port: 0 });
    await upgradeStatus(server.port, "wrong-token-value");
    const records = await dumpAudit(server.port, token);
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.detail).not.toContain(token);
      expect(record.detail).not.toContain("wrong-token-value");
    }
  });

  it("records a command that ran", async () => {
    const token = generateToken();
    server = await createActorServer({ allowedOrigins: [], token, port: 0 });
    await dumpAudit(server.port, token); // the dump itself is recorded after it returns
    const records = await dumpAudit(server.port, token);
    expect(records.some((r) => r.event === "command-ok")).toBe(true);
  });

  it("records a command that validation refused", async () => {
    const token = generateToken();
    server = await createActorServer({ allowedOrigins: [], token, port: 0 });
    const client = await connectClient(server.port, token);
    try {
      client.send(JSON.stringify({ v: ACTOR_PROTOCOL_VERSION, id: "bad-1", kind: "exec", runtime: "node", code: "", timeoutMs: 5000 }));
      const raw = await client.next();
      expect(JSON.parse(raw).ok).toBe(false);
    } finally {
      client.close();
    }
    const records = await dumpAudit(server.port, token);
    expect(records.some((r) => r.event === "command-denied")).toBe(true);
  });
});

describe("Actor server — rate limit", () => {
  it("refuses a flood and answers with rate-limited", async () => {
    const token = generateToken();
    server = await createActorServer({
      allowedOrigins: [],
      token,
      port: 0,
      rateLimit: { ratePerSecond: 1, burst: 2, maxViolations: 10 },
    });
    const client = await connectClient(server.port, token);
    try {
      const command = JSON.stringify({
        v: ACTOR_PROTOCOL_VERSION,
        id: "rl-1",
        kind: "audit-dump",
        timeoutMs: 5000,
      });
      // The first two fit in the burst; the third is over the limit.
      client.send(command);
      expect(JSON.parse(await client.next()).ok).toBe(true);
      client.send(command);
      expect(JSON.parse(await client.next()).ok).toBe(true);
      client.send(command);
      const refused = JSON.parse(await client.next());
      expect(refused.ok).toBe(false);
      expect(refused.code).toBe("rate-limited");
    } finally {
      client.close();
    }
    const records = await dumpAudit(server.port, token);
    expect(records.some((r) => r.event === "rate-limited")).toBe(true);
  });

  it("drops the connection after repeated violations", async () => {
    const token = generateToken();
    server = await createActorServer({
      allowedOrigins: [],
      token,
      port: 0,
      rateLimit: { ratePerSecond: 1, burst: 1, maxViolations: 2 },
    });
    const client = await connectClient(server.port, token);
    const command = JSON.stringify({ v: ACTOR_PROTOCOL_VERSION, id: "rl-2", kind: "audit-dump", timeoutMs: 5000 });
    client.send(command);
    await client.next();
    client.send(command);
    await client.next();
    // The third refusal trips maxViolations → the server destroys the socket.
    client.send(command);
    await client.next();
    await expect(client.next(1500)).rejects.toThrow();
    client.close();
  });
});
