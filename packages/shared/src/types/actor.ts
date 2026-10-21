/**
 * Actor layer contract — the wire protocol between the browser extension and
 * the local Actor bridge (a Node.js WebSocket server bound to 127.0.0.1).
 *
 * v2 adds the builtin `memory-summary` command (local Ollama summarization)
 * and keys the result by `kind`, so the UI can render both exec output and
 * structured memory without guessing at the shape.
 */

import type { MemorySource, MemoryStoreSnapshot, SavedMemoryEntry } from "./memory.js";

export const ACTOR_PROTOCOL_VERSION = 2 as const;

/** Hard limits enforced by `validateActorCommand` on every inbound command. */
export const ACTOR_LIMITS = {
  /** Upper bound on a memory-summary transcript (16 KiB). */
  maxTranscriptChars: 16 * 1024,
  /** Command timeout bounds (1s – 60s). */
  minTimeoutMs: 1_000,
  maxTimeoutMs: 60_000,
} as const;

/** Structured long-term memory produced by the local summarizer. */
export interface MemorySummary {
  facts: string[];
  preferences: string[];
  decisions: string[];
  open_loops: string[];
  summary: string;
}

/**
 * A command sent over the WebSocket. Discriminated by `kind`:
 *  - `exec` runs an allowlisted command line (Node only in this phase);
 *  - `memory-summary` is a builtin that summarizes a transcript via local
 *    Ollama — it is handled inside the Actor process and never spawns a shell.
 */
export type ActorCommand =
  | {
      v: typeof ACTOR_PROTOCOL_VERSION;
      id: string;
      kind: "exec";
      runtime: "node";
      code: string;
      timeoutMs: number;
    }
  | {
      v: typeof ACTOR_PROTOCOL_VERSION;
      id: string;
      kind: "memory-summary";
      transcript: string;
      timeoutMs: number;
    }
  | {
      v: typeof ACTOR_PROTOCOL_VERSION;
      id: string;
      kind: "memory-store";
      action: "save";
      memory: MemorySummary;
      model: string;
      source?: MemorySource;
      timeoutMs: number;
    }
  | {
      v: typeof ACTOR_PROTOCOL_VERSION;
      id: string;
      kind: "memory-store";
      action: "get";
      timeoutMs: number;
    }
  | {
      v: typeof ACTOR_PROTOCOL_VERSION;
      id: string;
      kind: "memory-store";
      action: "clear";
      timeoutMs: number;
    };

/** Error codes an Actor command can fail with. */
export type ActorErrorCode =
  | "denied"
  | "timeout"
  | "spawn-failed"
  | "ollama-unavailable"
  | "ollama-timeout"
  | "invalid-json"
  | "memory-io";

/**
 * Result of an Actor command. Success branches are keyed by `kind` so the UI
 * knows the shape without inspecting fields; failures share one shape.
 */
export type ActorResult =
  | {
      v: typeof ACTOR_PROTOCOL_VERSION;
      id: string;
      ok: true;
      kind: "exec";
      stdout: string;
      stderr: string;
      exitCode: number;
    }
  | {
      v: typeof ACTOR_PROTOCOL_VERSION;
      id: string;
      ok: true;
      kind: "memory-summary";
      memory: MemorySummary;
      model: string;
      elapsedMs: number;
    }
  | {
      v: typeof ACTOR_PROTOCOL_VERSION;
      id: string;
      ok: true;
      kind: "memory-store";
      action: "save";
      entry: SavedMemoryEntry;
    }
  | {
      v: typeof ACTOR_PROTOCOL_VERSION;
      id: string;
      ok: true;
      kind: "memory-store";
      action: "get";
      snapshot: MemoryStoreSnapshot;
    }
  | {
      v: typeof ACTOR_PROTOCOL_VERSION;
      id: string;
      ok: true;
      kind: "memory-store";
      action: "clear";
      cleared: true;
    }
  | {
      v: typeof ACTOR_PROTOCOL_VERSION;
      id: string;
      ok: false;
      code: ActorErrorCode;
      message: string;
    };

export interface ActorTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(command: ActorCommand): Promise<ActorResult>;
}
