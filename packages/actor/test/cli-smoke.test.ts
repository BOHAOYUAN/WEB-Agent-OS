import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, type AddressInfo } from "node:net";
import { createServer } from "node:http";
import type { ActorResult } from "@webos/shared";
import { ACTOR_PROTOCOL_VERSION } from "@webos/shared";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(testDir, "..", "..", "..");

let tmpDir = "";
let cliPath = "";

// Build the CLI entry once, to a temp .mjs bundle (so the @webos/shared alias
// and TypeScript resolve without tsx or a full project build).
beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "actor-cli-"));
  cliPath = join(tmpDir, "actor-cli.mjs");
  await build({
    entryPoints: [resolve(root, "packages/actor/src/cli.ts")],
    outfile: cliPath,
    bundle: true,
    platform: "node",
    target: ["node22"],
    format: "esm",
    alias: { "@webos/shared": resolve(root, "packages/shared/src/index.ts") },
    absWorkingDir: root,
    logLevel: "silent",
  });
}, 30000);

afterAll(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

/** Encode a masked client text frame (RFC 6455 §5.3). */
function encodeClientFrame(payload: string): Buffer {
  const data = Buffer.from(payload, "utf8");
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 1) masked[i] = data[i]! ^ mask[i % 4]!;

  let header: Buffer;
  if (data.length < 126) {
    header = Buffer.from([0x81, 0x80 | data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([header, mask, masked]);
}

/** Decode a single server frame (server frames are never masked). */
function decodeServerFrame(buffer: Buffer): { opcode: number; payload: Buffer; consumed: number } | null {
  if (buffer.length < 2) return null;
  const first = buffer[0]!;
  const second = buffer[1]!;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let payloadLength = second & 0x7f;
  let offset = 2;
  if (payloadLength === 126) {
    if (buffer.length < 4) return null;
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) return null;
    payloadLength = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + payloadLength) return null;
  let payload = buffer.subarray(offset + maskLength, offset + maskLength + payloadLength);
  if (masked) {
    const mask = buffer.subarray(offset, offset + 4);
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i += 1) payload[i] = payload[i]! ^ mask[i % 4]!;
  }
  return { opcode, payload, consumed: offset + maskLength + payloadLength };
}

function sendCommand(port: number, tokenValue: string, command: unknown): Promise<ActorResult> {
  return new Promise((resolvePromise, reject) => {
    const socket = connect(port, "127.0.0.1");
    let upgraded = false;
    let buffer: Buffer = Buffer.alloc(0);

    const fail = (msg: string): void => {
      socket.destroy();
      reject(new Error(msg));
    };

    const tryRead = (): void => {
      while (buffer.length >= 2) {
        const frame = decodeServerFrame(buffer);
        if (!frame) return;
        buffer = buffer.subarray(frame.consumed);
        if (frame.opcode === 0x1) {
          resolvePromise(JSON.parse(frame.payload.toString("utf8")) as ActorResult);
          socket.destroy();
          return;
        }
        if (frame.opcode === 0x8) {
          fail("server closed the connection");
          return;
        }
      }
    };

    socket.on("connect", () => {
      socket.write(
        [
          "GET /?token=" + tokenValue + " HTTP/1.1",
          "Host: 127.0.0.1:" + port,
          "Upgrade: websocket",
          "Connection: Upgrade",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"),
      );
    });

    socket.on("data", (chunk: Buffer) => {
      if (!upgraded) {
        const idx = chunk.indexOf("\r\n\r\n");
        if (idx === -1) return;
        const headerText = chunk.subarray(0, idx).toString("utf8");
        if (!headerText.startsWith("HTTP/1.1 101")) {
          fail("握手失败: " + headerText.split("\r\n")[0]);
          return;
        }
        upgraded = true;
        buffer = chunk.subarray(idx + 4);
        socket.write(encodeClientFrame(JSON.stringify(command)));
        tryRead();
        return;
      }
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      tryRead();
    });

    socket.on("error", (err) => reject(err));
    setTimeout(() => fail("timeout"), 15000);
  });
}

interface CliHandle {
  proc: ChildProcess;
  port: number;
  token: string;
  stop(): Promise<void>;
}

/** Spawn the built CLI bundle with extra args, waiting for its token banner. */
async function startCli(extraArgs: string[]): Promise<CliHandle> {
  const port = 40000 + Math.floor(Math.random() * 10000);
  const proc = spawn(process.execPath, [cliPath, "--port", String(port), ...extraArgs], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const token = await new Promise<string>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error("CLI 未打印 token")), 10000);
    let buf = "";
    proc.stdout!.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const m = buf.match(/\[actor\] token: (\S+)/);
      if (m) {
        clearTimeout(timer);
        resolvePromise(m[1]!);
      }
    });
    proc.stderr!.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
    });
    proc.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("CLI 提前退出 code=" + code));
    });
  });

  return {
    proc,
    port,
    token,
    async stop() {
      proc.kill();
      await new Promise((r) => setTimeout(r, 100));
    },
  };
}

interface FakeOllama {
  port: number;
  stop(): Promise<void>;
}

/**
 * A minimal Ollama `/api/chat` stub. It exercises the real HTTP path inside
 * `summarizeTranscript` (request body, `format:"json"`, response parsing)
 * while returning a deterministic fixed memory — no local model required.
 */
async function startFakeOllama(content: string): Promise<FakeOllama> {
  const server = createServer((req, res) => {
    if (req.url !== "/api/chat") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    req.on("data", () => {
      // Drain the request body (the stub does not inspect it).
    });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          model: "fake-model",
          message: { role: "assistant", content },
          eval_count: 42,
          eval_duration: 420_000_000, // 420ms in nanoseconds
        }),
      );
    });
  });
  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", () => resolvePromise()));
  const address = server.address() as AddressInfo;
  return {
    port: address.port,
    async stop() {
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    },
  };
}

const FIXED_MEMORY = {
  facts: ["固定事实一"],
  preferences: ["偏好一"],
  decisions: ["决策一"],
  open_loops: ["待办一"],
  summary: "固定总结",
};
const FIXED_CONTENT = JSON.stringify(FIXED_MEMORY);

describe("Actor CLI smoke (deterministic, fake Ollama)", () => {
  let cli: CliHandle;
  let fake: FakeOllama;

  beforeAll(async () => {
    fake = await startFakeOllama(FIXED_CONTENT);
    cli = await startCli(["--ollama-endpoint", "http://127.0.0.1:" + fake.port]);
  }, 30000);

  afterAll(async () => {
    await cli.stop();
    await fake.stop();
  });

  it("dispatches memory-summary and returns the fixed structured result", async () => {
    const result = await sendCommand(cli.port, cli.token, {
      v: ACTOR_PROTOCOL_VERSION,
      id: "smoke-1",
      kind: "memory-summary",
      transcript: "用户：你好\n助手：你好",
      timeoutMs: 5000,
    });
    expect(result.id).toBe("smoke-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("memory-summary");
      if (result.kind === "memory-summary") {
        expect(result.memory).toEqual(FIXED_MEMORY);
        expect(result.model).toBe("qwen2.5:3b");
        expect(typeof result.elapsedMs).toBe("number");
      }
    }
  }, 30000);

  it("reuses the token across a second connection", async () => {
    const first = await sendCommand(cli.port, cli.token, {
      v: ACTOR_PROTOCOL_VERSION,
      id: "smoke-2",
      kind: "memory-summary",
      transcript: "短对话",
      timeoutMs: 3000,
    });
    expect(first.id).toBe("smoke-2");
    expect(first.ok).toBe(true);
  }, 30000);
});

describe("Actor CLI memory-store round-trip (deterministic, no Ollama)", () => {
  let cli: CliHandle;
  let memDir = "";

  beforeAll(async () => {
    memDir = await mkdtemp(join(tmpdir(), "webos-mem-"));
    cli = await startCli(["--memory-path", join(memDir, "memory.json")]);
  }, 30000);

  afterAll(async () => {
    await cli.stop();
    if (memDir) await rm(memDir, { recursive: true, force: true });
  });

  it("saves, reads back, and clears a memory entry", async () => {
    const save = await sendCommand(cli.port, cli.token, {
      v: ACTOR_PROTOCOL_VERSION,
      id: "mem-1",
      kind: "memory-store",
      action: "save",
      memory: FIXED_MEMORY,
      model: "qwen2.5:3b",
      timeoutMs: 5000,
    });
    expect(save.ok).toBe(true);
    if (save.ok && save.kind === "memory-store" && save.action === "save") {
      expect(save.entry.memory).toEqual(FIXED_MEMORY);
    }

    const get = await sendCommand(cli.port, cli.token, {
      v: ACTOR_PROTOCOL_VERSION,
      id: "mem-2",
      kind: "memory-store",
      action: "get",
      timeoutMs: 5000,
    });
    expect(get.ok).toBe(true);
    if (get.ok && get.kind === "memory-store" && get.action === "get") {
      expect(get.snapshot.entries).toHaveLength(1);
      expect(get.snapshot.entries[0]?.memory).toEqual(FIXED_MEMORY);
    }

    const clear = await sendCommand(cli.port, cli.token, {
      v: ACTOR_PROTOCOL_VERSION,
      id: "mem-3",
      kind: "memory-store",
      action: "clear",
      timeoutMs: 5000,
    });
    expect(clear.ok).toBe(true);
  }, 30000);
});

// Real end-to-end against a live local model. Opt-in only: requires Ollama to
// be running with qwen2.5:3b pulled. Run with `ACTOR_E2E=1 npm run test`.
describe.skipIf(process.env.ACTOR_E2E !== "1")("Actor CLI real Ollama integration", () => {
  let cli: CliHandle;

  beforeAll(async () => {
    cli = await startCli([]);
  }, 30000);

  afterAll(async () => {
    await cli.stop();
  });

  it("summarizes with the real local model and returns a structured memory", async () => {
    const result = await sendCommand(cli.port, cli.token, {
      v: ACTOR_PROTOCOL_VERSION,
      id: "real-1",
      kind: "memory-summary",
      transcript: "用户：下一步做 Stage 1b。\n助手：做 sidepanel actor-client 和 token UI。",
      timeoutMs: 15000,
    });
    expect(result.id).toBe("real-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("memory-summary");
      if (result.kind === "memory-summary") {
        expect(result.model).toBe("qwen2.5:3b");
        expect(typeof result.elapsedMs).toBe("number");
        expect(result.memory.summary.length).toBeGreaterThan(0);
      }
    }
  }, 60000);
});
