/**
 * Builtin Actor capabilities that run entirely inside the process (no shell,
 * no command allowlist): local Ollama summarization and the on-disk memory
 * store. Each returns an `ActorResult` keyed by `kind`.
 */

import { ACTOR_PROTOCOL_VERSION } from "@webos/shared";
import type { ActorCommand, ActorResult } from "@webos/shared";
import { summarizeTranscript } from "./summarize.js";
import { MemoryStore } from "./store.js";

export interface SummarizeConfig {
  endpoint?: string;
  model?: string;
}

export async function handleMemorySummary(
  command: Extract<ActorCommand, { kind: "memory-summary" }>,
  ollama?: SummarizeConfig,
): Promise<ActorResult> {
  const result = await summarizeTranscript({
    transcript: command.transcript,
    timeoutMs: command.timeoutMs,
    endpoint: ollama?.endpoint,
    model: ollama?.model,
  });

  if (!result.ok) {
    return { v: ACTOR_PROTOCOL_VERSION, id: command.id, ok: false, code: result.code, message: result.message };
  }
  return {
    v: ACTOR_PROTOCOL_VERSION,
    id: command.id,
    ok: true,
    kind: "memory-summary",
    memory: result.memory,
    model: result.model,
    elapsedMs: result.elapsedMs,
  };
}

export async function handleMemoryStore(
  command: Extract<ActorCommand, { kind: "memory-store" }>,
  store: MemoryStore,
): Promise<ActorResult> {
  try {
    if (command.action === "save") {
      const entry = await store.save(command.memory, command.model, command.source ?? {});
      return { v: ACTOR_PROTOCOL_VERSION, id: command.id, ok: true, kind: "memory-store", action: "save", entry };
    }
    if (command.action === "get") {
      const snapshot = await store.load();
      return { v: ACTOR_PROTOCOL_VERSION, id: command.id, ok: true, kind: "memory-store", action: "get", snapshot };
    }
    await store.clear();
    return { v: ACTOR_PROTOCOL_VERSION, id: command.id, ok: true, kind: "memory-store", action: "clear", cleared: true };
  } catch (error) {
    return {
      v: ACTOR_PROTOCOL_VERSION,
      id: command.id,
      ok: false,
      code: "memory-io",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
