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
