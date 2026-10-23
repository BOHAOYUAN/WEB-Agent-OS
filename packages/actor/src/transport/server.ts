/**
 * WebSocket server for the local Actor bridge — hand-rolled on node:http.
 *
 * Lifecycle of a connection:
 *   1. HTTP upgrade request arrives on 127.0.0.1.
 *   2. Origin is checked against the allowlist (token-first: an absent Origin
 *      skips the check), then the reusable token is verified. Either failing
 *      rejects the upgrade.
 *   3. On success the socket is upgraded and wrapped in a FrameDecoder; the
 *      heartbeat starts.
 *   4. Text messages are validated against the v2 contract and dispatched to a
 *      handler; responses are encoded as text frames.
 *
 * No shell is ever invoked for builtin commands; `exec` is delegated to the
 * runner, which itself only runs allowlisted argv.
 */

import { createServer } from "node:http";
import type { Socket } from "node:net";
import type { IncomingMessage } from "node:http";
import type { ActorCommand, ActorResult } from "@webos/shared";
import { ACTOR_PROTOCOL_VERSION, isRecord, validateActorCommand } from "@webos/shared";
import { evaluateHandshake } from "./handshake.js";
import { encodeFrame, FrameDecoder } from "./frame.js";
import { Heartbeat } from "./heartbeat.js";
import { ReusableToken } from "../security/token.js";
import { evaluateCommand } from "../security/command-policy.js";
import { AuditLog, DEFAULT_AUDIT_CAPACITY } from "../security/audit-log.js";
import { RateLimiter, type RateLimiterOptions } from "../security/rate-limit.js";
import { executeCommand, type ExecutionOptions } from "../exec/runner.js";
import { handleMemoryStore, handleMemorySummary, type SummarizeConfig } from "../memory/builtin.js";
import { MemoryStore, DEFAULT_MEMORY_PATH } from "../memory/store.js";
import { SqliteMemoryStore, DEFAULT_SQLITE_PATH } from "../memory/sqlite-store.js";
import type { MemoryBackend, MemoryStoreLike } from "../memory/types.js";

export type { SummarizeConfig } from "../memory/builtin.js";

export interface ActorServerOptions {
  /** Origins allowed to connect (e.g. the extension's origin). */
  allowedOrigins: readonly string[];
  /** The reusable handshake token the extension must present. */
  token: string;
  /** Host to bind (always 127.0.0.1 in practice). */
  host?: string;
  /** Port to bind. Defaults to 0 (ephemeral) for tests. */
  port?: number;
  /** Execution containment defaults. */
  exec?: Partial<ExecutionOptions>;
  /** Local Ollama config for the memory-summary builtin. */
  ollama?: SummarizeConfig;
  /** Which on-disk backend to use. SQLite is the default; JSON is the legacy path. */
  memoryBackend?: MemoryBackend;
  /** Override the store path (defaults per backend: memory.db / memory.json). */
  memoryPath?: string;
  /** Heartbeat tuning. */
  heartbeat?: { intervalMs?: number; timeoutMs?: number };
  /** Audit trail capacity (records kept in memory). */
  auditCapacity?: number;
  /** Per-connection command rate limit. */
  rateLimit?: RateLimiterOptions;
  /** Command handler override (for tests). Defaults to local execution. */
  onCommand?: (command: ActorCommand) => Promise<ActorResult>;
  /** Log sink (defaults to console.debug when __DEV__). */
  log?: (line: string) => void;
}

export interface ActorServer {
  /** The bound port (useful when port: 0 was requested). */
  port: number;
  /** The token value, for the user to copy into the extension. */
  token: string;
  /** Stop the server and close all live connections. */
  stop(): Promise<void>;
}

interface LiveConnection {
  socket: Socket;
  decoder: FrameDecoder;
  heartbeat: Heartbeat;
}

const DEFAULT_EXEC: ExecutionOptions = {
  cwd: process.cwd(),
  timeoutMs: 10_000,
  maxOutputBytes: 1024 * 1024,
};

/**
 * Create and start the local Actor WebSocket server.
 */
export async function createActorServer(options: ActorServerOptions): Promise<ActorServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const allowedOrigins = options.allowedOrigins;
  const reusable = new ReusableToken(options.token);
  const exec: ExecutionOptions = { ...DEFAULT_EXEC, ...options.exec };
  const log = options.log ?? (() => undefined);
  const backend: MemoryBackend = options.memoryBackend ?? "sqlite";
  const store: MemoryStoreLike =
    backend === "json"
      ? new MemoryStore({ path: options.memoryPath ?? DEFAULT_MEMORY_PATH })
      : new SqliteMemoryStore({ path: options.memoryPath ?? DEFAULT_SQLITE_PATH });

  const connections = new Set<LiveConnection>();

  // One audit trail for the whole bridge: a reviewer wants the sequence of
  // decisions across connections, not per-socket fragments. Every record is
  // redacted before it is stored, and mirrored to the log sink.
  const audit = new AuditLog({
    capacity: options.auditCapacity ?? DEFAULT_AUDIT_CAPACITY,
    onRecord: (record) => log(`[audit] ${record.event} ${record.detail}`.trimEnd()),
  });

  const server = createServer();

  // A browser tab closing mid-frame can surface as ECONNRESET on the socket.
  // Without these listeners Node treats it as an unhandled 'error' event and
  // kills the whole Actor process. A local bridge must survive client resets.
  server.on("clientError", (_error, socket) => {
    socket.destroy();
  });

  // Non-upgrade requests (plain HTTP) get a short informational response so
  // they don't hang; this bridge speaks WebSocket only.
  server.on("request", (_request, response) => {
    response.writeHead(426, { "Content-Type": "text/plain" });
    response.end("upgrade required");
  });

  // WebSocket upgrade is handled on the dedicated `upgrade` event (not inside
  // the request callback), which is the correct way to hand the socket over to
  // a custom protocol handler under node:http.
  server.on("upgrade", (request: IncomingMessage, socket: Socket) => {
    // Never let a client-side reset crash the process. The socket is still
    // usable for cleanup; destroy() is idempotent.
    socket.on("error", () => {
      socket.destroy();
    });

    const handshake = evaluateHandshake(
      {
        method: request.method,
        headers: request.headers as Record<string, string | undefined>,
        url: request.url,
      },
      { allowedOrigins },
    );

    if (!handshake.ok) {
      audit.record("handshake-denied", handshake.reason ?? "handshake rejected");
      socket.write(
        `HTTP/1.1 ${handshake.status ?? 403} Forbidden\r\nConnection: close\r\n\r\n`,
      );
      socket.destroy();
      return;
    }

    // Token is presented via a query param or a header. Query param is the
    // extension's path (chrome WebSocket can't set custom headers easily).
    const url = new URL(request.url ?? "/", "http://localhost");
    const candidate = url.searchParams.get("token") ?? request.headers["x-webos-token"];
    if (typeof candidate !== "string" || !reusable.verify(candidate)) {
      // The candidate value is NEVER recorded — only the fact that it failed.
      // The token is reusable, so writing it anywhere would hand out the bridge.
      audit.record("token-denied", "reusable token rejected");
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    // Complete the upgrade by writing the 101 response directly to the socket.
    const headers = handshake.headers ?? {};
    const headerLines = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${headers["Sec-WebSocket-Accept"] ?? ""}`,
      "",
      "",
    ].join("\r\n");
    socket.write(headerLines);

    const connection = attachConnection(socket, {
      exec,
      log,
      audit,
      limiter: new RateLimiter(options.rateLimit),
      ollama: options.ollama,
      store,
      onCommand: options.onCommand,
      heartbeat: options.heartbeat,
    });
    connections.add(connection);
    socket.on("close", () => {
      connection.heartbeat.stop();
      connections.delete(connection);
      audit.record("connection-closed");
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : port;

  return {
    port: boundPort,
    token: options.token,
    async stop() {
      for (const connection of connections) {
        connection.heartbeat.stop();
        connection.socket.destroy();
      }
      connections.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      // Release the database handle last: on Windows an open handle keeps
      // memory.db locked after the listener is already down.
      store.close?.();
    },
  };
}

interface AttachOptions {
  exec: ExecutionOptions;
  log: (line: string) => void;
  audit: AuditLog;
  /** One limiter per connection — a client cannot spend another's budget. */
  limiter: RateLimiter;
  ollama?: SummarizeConfig;
  store: MemoryStoreLike;
  onCommand?: (command: ActorCommand) => Promise<ActorResult>;
  heartbeat?: { intervalMs?: number; timeoutMs?: number };
}

function attachConnection(socket: Socket, options: AttachOptions): LiveConnection {
  const heartbeat = new Heartbeat({
    intervalMs: options.heartbeat?.intervalMs ?? 30_000,
    timeoutMs: options.heartbeat?.timeoutMs ?? 10_000,
    onPing: (payload) => {
      try {
        socket.write(encodeFrame(0x9, payload));
      } catch {
        /* socket gone */
      }
    },
    onTimeout: () => socket.destroy(),
  });

  const decoder = new FrameDecoder({
    onMessage: (data, binary) => {
      void handleMessage(data, binary, socket, options);
    },
    onClose: () => socket.end(encodeFrame(0x8, Buffer.from([0x03, 0xe8]))),
    onPing: (payload) => {
      try {
        socket.write(encodeFrame(0xa, payload));
      } catch {
        /* socket gone */
      }
    },
    onPong: () => heartbeat.markAlive(),
    onError: () => socket.destroy(),
  });

  socket.on("data", (chunk: Buffer) => {
    heartbeat.markAlive();
    decoder.push(chunk);
  });

  heartbeat.start();

  return { socket, decoder, heartbeat };
}

async function handleMessage(
  data: Buffer,
  _binary: boolean,
  socket: Socket,
  options: AttachOptions,
): Promise<void> {
  // Rate limit FIRST — before parsing, before validation. A flooded socket
  // must never reach the command path.
  if (!options.limiter.tryConsume()) {
    options.audit.record(
      "rate-limited",
      `command refused (violation ${options.limiter.violationCount})`,
    );
    sendResult(socket, {
      v: ACTOR_PROTOCOL_VERSION,
      id: "",
      ok: false,
      code: "rate-limited",
      message: "rate limit exceeded",
    });
    // A client that keeps pushing after being refused is not a slow client.
    if (options.limiter.shouldDrop()) {
      options.audit.record("connection-closed", "dropped after repeated rate-limit violations");
      socket.destroy();
    }
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString("utf8"));
  } catch {
    options.audit.record("malformed-frame", "invalid JSON");
    sendResult(socket, { v: ACTOR_PROTOCOL_VERSION, id: "", ok: false, code: "denied", message: "malformed JSON" });
    return;
  }

  const validation = validateActorCommand(parsed);
  if (!validation.ok) {
    const id = isRecord(parsed) && typeof parsed.id === "string" ? parsed.id : "";
    options.audit.record("command-denied", validation.reason);
    sendResult(socket, { v: ACTOR_PROTOCOL_VERSION, id, ok: false, code: "denied", message: validation.reason });
    return;
  }
  const command = validation.command;

  let result: ActorResult;
  if (options.onCommand) {
    result = await options.onCommand(command);
  } else {
    result = await defaultCommandHandler(command, options.exec, options.ollama, options.store, options.audit);
  }

  // Exactly one record per command: the decision lives with the decision.
  if (result.ok) {
    options.audit.record("command-ok", command.kind);
  } else if (result.code === "denied") {
    options.audit.record("command-denied", result.message);
  } else {
    options.audit.record("command-failed", `${result.code}: ${result.message}`);
  }
  sendResult(socket, result);
}

async function defaultCommandHandler(
  command: ActorCommand,
  exec: ExecutionOptions,
  ollama?: SummarizeConfig,
  store?: MemoryStoreLike,
  audit?: AuditLog,
): Promise<ActorResult> {
  if (command.kind === "memory-summary") {
    return handleMemorySummary(command, ollama);
  }
  if (command.kind === "memory-store") {
    return handleMemoryStore(command, store ?? new MemoryStore());
  }
  if (command.kind === "audit-dump") {
    // Read-only: the trail is already redacted, so exporting it cannot leak
    // the token or a command line.
    return {
      v: ACTOR_PROTOCOL_VERSION,
      id: command.id,
      ok: true,
      kind: "audit-dump",
      records: audit?.list() ?? [],
    };
  }
  return handleExec(command, exec);
}

async function handleExec(
  command: Extract<ActorCommand, { kind: "exec" }>,
  exec: ExecutionOptions,
): Promise<ActorResult> {
  // The "code" field is treated as a command line to run, not raw source. It
  // MUST pass the allowlist/denylist before anything is spawned.
  const policy = evaluateCommand(command.code);
  if (!policy.ok) {
    return { v: ACTOR_PROTOCOL_VERSION, id: command.id, ok: false, code: "denied", message: policy.reason };
  }

  const outcome = await executeCommand(policy.argv, {
    cwd: exec.cwd,
    timeoutMs: Math.min(command.timeoutMs || exec.timeoutMs, exec.timeoutMs),
    maxOutputBytes: exec.maxOutputBytes,
  });

  if (outcome.spawnError) {
    return { v: ACTOR_PROTOCOL_VERSION, id: command.id, ok: false, code: "spawn-failed", message: outcome.spawnError };
  }
  if (outcome.timedOut) {
    return { v: ACTOR_PROTOCOL_VERSION, id: command.id, ok: false, code: "timeout", message: "command timed out" };
  }
  const exitCode = outcome.exitCode ?? 1;
  if (outcome.ok) {
    return {
      v: ACTOR_PROTOCOL_VERSION,
      id: command.id,
      ok: true,
      kind: "exec",
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      exitCode,
    };
  }
  return {
    v: ACTOR_PROTOCOL_VERSION,
    id: command.id,
    ok: false,
    code: "denied",
    message: `command exited with code ${exitCode}`,
  };
}

function sendResult(socket: Socket, result: ActorResult): void {
  try {
    socket.write(encodeFrame(0x1, JSON.stringify(result)));
  } catch {
    /* socket gone */
  }
}
