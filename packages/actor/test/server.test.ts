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
 * Server wiring tests. The full WebSocket happy path (frame encode/decode,
 * handshake key computation) is covered by frame.test.ts and handshake.test.ts
 * as pure functions. Here we verify the HTTP upgrade layer rejects correctly:
 *   - no Origin header -> 403
 *   - wrong token -> 401
 *   - a successful upgrade consumes the one-shot token.
 */
describe("Actor server — upgrade rejection", () => {
  it("rejects a connection with no Origin header (403)", async () => {
    const token = generateToken();
    server = await createActorServer({ allowedOrigins: ["chrome-extension://abc"], token, port: 0 });

    const http = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: server!.port,
          method: "GET",
          path: `/?token=${token}`,
          headers: {
            Upgrade: "websocket",
            Connection: "Upgrade",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version": "13",
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("rejects a connection with a wrong token (401)", async () => {
    const token = generateToken();
    server = await createActorServer({ allowedOrigins: ["chrome-extension://abc"], token, port: 0 });

    const http = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: server!.port,
          method: "GET",
          path: "/?token=wrong",
          headers: {
            Upgrade: "websocket",
            Connection: "Upgrade",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version": "13",
            Origin: "chrome-extension://abc",
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(401);
  });

  it("accepts a valid upgrade and consumes the one-shot token", async () => {
    const token = generateToken();
    server = await createActorServer({ allowedOrigins: ["chrome-extension://abc"], token, port: 0 });

    const http = await import("node:http");
    // First connection with the correct token must upgrade (101).
    const first = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: server!.port,
          method: "GET",
          path: `/?token=${token}`,
          headers: {
            Upgrade: "websocket",
            Connection: "Upgrade",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version": "13",
            Origin: "chrome-extension://abc",
          },
        },
      );
      const timer = setTimeout(() => resolve(0), 3000);
      req.on("upgrade", (_res, socket) => {
        clearTimeout(timer);
        socket.destroy();
        resolve(101);
      });
      req.on("response", (res) => {
        clearTimeout(timer);
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", () => {
        clearTimeout(timer);
        reject(new Error("request error"));
      });
      req.end();
    });
    expect(first).toBe(101);

    // Reuse the same (now consumed) token -> 401.
    const second = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: server!.port,
          method: "GET",
          path: `/?token=${token}`,
          headers: {
            Upgrade: "websocket",
            Connection: "Upgrade",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version": "13",
            Origin: "chrome-extension://abc",
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(second).toBe(401);
  }, 10000);
});

describe("Actor server — command policy integration", () => {
  it("denies a dangerous command before any spawn", () => {
    expect(evaluateCommand("rm -rf /").ok).toBe(false);
    expect(evaluateCommand("git log $(whoami)").ok).toBe(false);
    expect(evaluateCommand("git log | grep foo").ok).toBe(false);
  });

  it("allows a safe allowlisted command", () => {
    const result = evaluateCommand("git status");
    expect(result.ok).toBe(true);
  });
});
