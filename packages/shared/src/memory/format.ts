/**
 * Format a structured memory summary into a compact system-prompt fragment.
 *
 * The order is fixed (summary → facts → preferences → decisions → open loops)
 * and the result is truncated to `maxChars` on whole-line boundaries, so an
 * injected memory can never balloon the prompt.
 */

import type { MemorySummary } from "../types/actor.js";
import { MAX_MEMORY_INJECT_CHARS } from "../types/memory.js";

const SECTION_SEPARATOR = "\n\n---\n\n";

function truncateToMaxChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  let out = "";
  for (const line of text.split("\n")) {
    const candidate = out.length === 0 ? line : out + "\n" + line;
    if (candidate.length > maxChars) break;
    out = candidate;
  }
  return out;
}

/**
 * Render `memory` as prompt text. Empty fields are omitted entirely; the whole
 * fragment never exceeds `maxChars`.
 */
export function formatMemoryForPrompt(memory: MemorySummary, maxChars: number = MAX_MEMORY_INJECT_CHARS): string {
  const sections: string[] = [];

  const summary = (memory.summary ?? "").trim();
  if (summary.length > 0) sections.push(summary);

  const pushSection = (label: string, items: string[]): void => {
    const cleaned = items.map((item) => item.trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    sections.push([label, ...cleaned.map((item) => `- ${item}`)].join("\n"));
  };

  pushSection("事实", memory.facts);
  pushSection("偏好", memory.preferences);
  pushSection("决策", memory.decisions);
  pushSection("待办", memory.open_loops);

  return truncateToMaxChars(sections.join(SECTION_SEPARATOR), maxChars);
}
