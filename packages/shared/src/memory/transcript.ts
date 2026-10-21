/**
 * Turn a flat sensor event stream into a conversation transcript for the
 * summarizer. Pairs opt-in `sensor.user.prompt` events with the assistant
 * answer deltas that share the same requestId, ignoring thinking deltas.
 */

import type { SensorEvent } from "../types/events.js";
import { MAX_TRANSCRIPT_CHARS } from "../types/memory.js";

export interface TranscriptResult {
  transcript: string;
  turns: number;
  chars: number;
  hasUserPrompts: boolean;
}

const TURN_SEPARATOR = "\n\n";

/**
 * Build a transcript from a sensor event stream.
 *
 * - When user prompts are present, only fully-paired turns (user prompt with a
 *   non-empty assistant answer) are emitted; orphan prompts are skipped.
 * - When no user prompts are present, fall back to assistant-only turns.
 * - The most recent turns are kept; the oldest are dropped once the transcript
 *   would exceed `maxChars`.
 */
export function buildTranscript(events: SensorEvent[], maxChars: number = MAX_TRANSCRIPT_CHARS): TranscriptResult {
  const answerParts = new Map<string, string[]>();
  const requestOrder: string[] = [];
  const userPrompts: Array<{ requestId: string; text: string }> = [];

  for (const event of events) {
    if (event.type === "sensor.text.delta" && event.channel === "answer") {
      let parts = answerParts.get(event.requestId);
      if (!parts) {
        parts = [];
        answerParts.set(event.requestId, parts);
        requestOrder.push(event.requestId);
      }
      parts.push(event.text);
    } else if (event.type === "sensor.user.prompt") {
      userPrompts.push({ requestId: event.requestId, text: event.text });
    }
  }

  const turns: string[] = [];
  const hasAnyUserPrompts = userPrompts.length > 0;

  if (hasAnyUserPrompts) {
    for (const prompt of userPrompts) {
      const answer = (answerParts.get(prompt.requestId) ?? []).join("").trim();
      if (answer.length === 0) continue; // orphan prompt, no answer yet
      turns.push(`用户：${prompt.text}\n助手：${answer}`);
    }
  } else {
    for (const requestId of requestOrder) {
      const answer = (answerParts.get(requestId) ?? []).join("").trim();
      if (answer.length === 0) continue;
      turns.push(`助手：${answer}`);
    }
  }

  // Keep the most recent turns; truncate the oldest beyond maxChars.
  let transcript = "";
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn === undefined) continue;
    const candidate = transcript.length === 0 ? turn : turn + TURN_SEPARATOR + transcript;
    if (candidate.length > maxChars) break;
    transcript = candidate;
  }

  return {
    transcript,
    turns: turns.length,
    chars: transcript.length,
    hasUserPrompts: hasAnyUserPrompts && turns.length > 0,
  };
}
