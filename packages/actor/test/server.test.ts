import { afterEach, describe, expect, it } from "vitest";
import { createActorServer, type ActorServer } from "../src/transport/server.js";
import { generateToken } from "../src/security/token.js";
import { evaluateCommand } from "../src/security/command-policy.js";

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
