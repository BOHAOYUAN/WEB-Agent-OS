import { MAX_USER_PROMPT_CHARS } from "../types/memory.js";

export interface CompletionMeta {
  thinkingEnabled: boolean;
  searchEnabled?: boolean;
}

const MAX_META_BODY_CHARS = 1024 * 1024;

/**
 * Extract ONLY the completion flags the sensor needs. The prompt and any other
 * request fields must never leave this function.
 */
export function extractCompletionMeta(rawBody: unknown): CompletionMeta {
  if (typeof rawBody !== "string" || rawBody.length === 0 || rawBody.length > MAX_META_BODY_CHARS) {
    return { thinkingEnabled: false };
  }
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { thinkingEnabled: false };
    }
    const record = parsed as Record<string, unknown>;
    const meta: CompletionMeta = { thinkingEnabled: record.thinking_enabled === true };
    if (typeof record.search_enabled === "boolean") meta.searchEnabled = record.search_enabled;
    return meta;
  } catch {
    return { thinkingEnabled: false };
  }
}

export function bodyToMetaText(rawBody: unknown): string | undefined {
  if (typeof rawBody === "string") return rawBody;
  if (rawBody instanceof URLSearchParams) return rawBody.toString();
  return undefined;
}

/**
 * Extract the user's question text from a completion request body (opt-in
 * memory capture only — this function is never called unless the user enabled
 * capture). Returns null when the body is unreadable, oversized, or carries
 * neither a `prompt` string nor a trailing `user` message.
 */
export function extractUserPrompt(rawBody: unknown, maxChars = MAX_USER_PROMPT_CHARS): string | null {
  if (typeof rawBody !== "string" || rawBody.length === 0 || rawBody.length > MAX_META_BODY_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;

  if (typeof record.prompt === "string") {
    const prompt = record.prompt.trim();
    return prompt.length > 0 && prompt.length <= maxChars ? prompt : null;
  }

  if (Array.isArray(record.messages)) {
    for (let index = record.messages.length - 1; index >= 0; index -= 1) {
      const message = record.messages[index];
      if (typeof message !== "object" || message === null) continue;
      const role = (message as Record<string, unknown>).role;
      if (role !== "user") continue;
      const content = (message as Record<string, unknown>).content;
      if (typeof content !== "string") return null;
      const text = content.trim();
      return text.length > 0 && text.length <= maxChars ? text : null;
    }
  }

  return null;
}
