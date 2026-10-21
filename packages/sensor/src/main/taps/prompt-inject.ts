/**
 * System-prompt injection into a completion request body.
 *
 * This is the ONLY place a request body is rewritten. It is deliberately narrow
 * and defensive:
 *  - only handles a JSON string body (DeepSeek's actual transport shape);
 *  - appends a `system` message to `messages`, leaving every other top-level
 *    field byte-for-byte intact;
 *  - never reads or writes request metadata (auth, cookies, headers);
 *  - never throws — a failed inject returns the original body unchanged.
 */

export interface InjectResult {
  rewritten: unknown;
  injected: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Append `prompt` as a trailing system message to a JSON completion body.
 * Returns `injected: false` (with the original body) whenever the body is not a
 * plain JSON string, carries neither a `messages` array nor a `prompt` string,
 * or already contains the same prompt.
 */
export function injectSystemPrompt(body: unknown, prompt: string): InjectResult {
  if (typeof body !== "string" || body.length === 0) return { rewritten: body, injected: false };
  if (!prompt || prompt.length === 0) return { rewritten: body, injected: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { rewritten: body, injected: false };
  }

  if (!isRecord(parsed)) return { rewritten: body, injected: false };

  // DeepSeek completion bodies arrive in two shapes:
  //   - OpenAI/API-compatible clients send a `messages: [...]` array;
  //   - the chat.deepseek.com web client sends a flat `prompt: string`.
  // Handle both so injection works regardless of which transport the page uses.
  if (Array.isArray(parsed.messages)) {
    return injectIntoMessages(parsed, prompt, body);
  }
  if (typeof parsed.prompt === "string") {
    return injectIntoPrompt(parsed, prompt, body);
  }

  return { rewritten: body, injected: false };
}

function injectIntoMessages(parsed: Record<string, unknown>, prompt: string, originalBody: string): InjectResult {
  // Shallow-copy so the original object is never mutated.
  const messages = (parsed.messages as unknown[]).map((message) => (isRecord(message) ? { ...message } : message));

  // Idempotency: if the trailing message already carries this exact prompt, skip.
  const last = messages.at(-1);
  if (isRecord(last) && last.role === "system" && last.content === prompt) {
    return { rewritten: originalBody, injected: false };
  }

  messages.push({ role: "system", content: prompt });
  const next = { ...parsed, messages };

  try {
    return { rewritten: JSON.stringify(next), injected: true };
  } catch {
    return { rewritten: originalBody, injected: false };
  }
}

function injectIntoPrompt(parsed: Record<string, unknown>, prompt: string, originalBody: string): InjectResult {
  const originalPrompt = parsed.prompt as string;

  // Idempotency: don't prepend the same system instruction twice.
  if (originalPrompt.includes(prompt)) {
    return { rewritten: originalBody, injected: false };
  }

  // The web client has no system role; prepend the instruction to the user's
  // prompt with a clear delimiter so the model treats it as a system directive.
  const next = { ...parsed, prompt: `${prompt}\n\n---\n\n${originalPrompt}` };

  try {
    return { rewritten: JSON.stringify(next), injected: true };
  } catch {
    return { rewritten: originalBody, injected: false };
  }
}
