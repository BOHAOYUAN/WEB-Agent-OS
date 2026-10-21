/**
 * Memory contract shared across the extension, the sensor, and the Actor.
 *
 * `SystemContext` is the single merged slot that replaces the old single-prompt
 * injection: persona (from the Router) and memory (from the user's "inject next
 * turn" action) merge into ONE context so they can no longer overwrite each
 * other. The saved-entry / snapshot types model the on-disk store
 * (`~/.webos-agent/memory.json`) that the Actor owns.
 */

import type { MemorySummary } from "./actor.js";

/** Combined system context injected into the next completion request. */
export interface SystemContext {
  persona?: string;
  memory?: string;
}

export interface MemorySource {
  tabId?: number;
  pageSessionId?: string;
  turnCount?: number;
}

export interface SavedMemoryEntry {
  id: string;
  savedAt: string;
  model: string;
  source: MemorySource;
  memory: MemorySummary;
}

export interface MemoryStoreSnapshot {
  schemaVersion: 1;
  entries: SavedMemoryEntry[];
}

/** Upper bound on the memory text injected into a prompt (anti-bloat). */
export const MAX_MEMORY_INJECT_CHARS = 600;
/** Upper bound on a captured user prompt. */
export const MAX_USER_PROMPT_CHARS = 8 * 1024;
/** Upper bound on a transcript sent to the summarizer. */
export const MAX_TRANSCRIPT_CHARS = 16 * 1024;

export function isMemorySummary(value: unknown): value is MemorySummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((item) => typeof item === "string");
  return (
    isStrArray(record.facts) &&
    isStrArray(record.preferences) &&
    isStrArray(record.decisions) &&
    isStrArray(record.open_loops) &&
    typeof record.summary === "string"
  );
}

export function isSystemContext(value: unknown): value is SystemContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.persona !== undefined && typeof record.persona !== "string") return false;
  if (record.memory !== undefined && typeof record.memory !== "string") return false;
  return record.persona !== undefined || record.memory !== undefined;
}

export function isMemorySource(value: unknown): value is MemorySource {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.tabId === undefined || typeof record.tabId === "number") &&
    (record.pageSessionId === undefined || typeof record.pageSessionId === "string") &&
    (record.turnCount === undefined || typeof record.turnCount === "number")
  );
}

export function isSavedMemoryEntry(value: unknown): value is SavedMemoryEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.savedAt === "string" &&
    typeof record.model === "string" &&
    isMemorySource(record.source) &&
    isMemorySummary(record.memory)
  );
}

export function isMemoryStoreSnapshot(value: unknown): value is MemoryStoreSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && Array.isArray(record.entries) && record.entries.every(isSavedMemoryEntry);
}
