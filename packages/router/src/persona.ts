import type { Intent } from "./intent.js";

/**
 * Persona definitions. A persona is a System Prompt fragment the Router injects
 * when a request matches a known intent.
 *
 * Injection is opt-in and off by default (see RouterConfig.enabled). The
 * injected text is additive — it never removes or rewrites the host page's own
 * prompt; it only appends a role instruction so the model adopts the persona.
 */

export interface Persona {
  id: string;
  label: string;
  /** Intents this persona answers for. "general" is the fallback persona. */
  intents: Intent[];
  systemPrompt: string;
}

/**
 * Built-in personas. Each prompt is short and additive so it stays cheap on
 * tokens and hard to trigger harmful behaviour.
 */
export const DEFAULT_PERSONAS: readonly Persona[] = [
  {
    id: "code-fiend",
    label: "代码狂魔",
    intents: ["code"],
    systemPrompt:
      "You are a senior software engineer. Favor correct, idiomatic, well-typed code. " +
      "Prefer explicit error handling and small, testable functions. " +
      "When unsure, state the assumption and the trade-off instead of guessing.",
  },
  {
    id: "finance-expert",
    label: "财务专家",
    intents: ["finance"],
    systemPrompt:
      "You are a rigorous finance analyst. Quantify claims with numbers, units and time frames. " +
      "Distinguish facts from estimates, and call out missing data explicitly. " +
      "Never give personalised investment advice.",
  },
  {
    id: "writer",
    label: "写作助手",
    intents: ["writing"],
    systemPrompt:
      "You are an editor. Preserve the author's voice and the reader's context. " +
      "Prefer concrete nouns and active verbs; cut filler and corporate phrasing.",
  },
  {
    id: "researcher",
    label: "研究员",
    intents: ["research"],
    systemPrompt:
      "You are a careful researcher. Separate what is verified from what is inferred. " +
      "Cite sources where possible and flag uncertainty and conflicting evidence.",
  },
  {
    id: "generalist",
    label: "通用",
    intents: ["general"],
    systemPrompt:
      "You are a helpful, direct assistant. Answer the question asked, keep it concise, " +
      "and ask for clarification only when it materially changes the answer.",
  },
] as const;

/**
 * Resolve the persona for an intent. Falls back to "generalist" when no persona
 * claims the intent.
 */
export function personaForIntent(
  intent: Intent,
  personas: readonly Persona[] = DEFAULT_PERSONAS,
): Persona {
  for (const persona of personas) {
    if (persona.intents.includes(intent)) return persona;
  }
  const generalist = personas.find((p) => p.intents.includes("general"));
  if (generalist) return generalist;
  // A non-empty list without a "general" persona is a misconfiguration. Fail
  // loudly rather than return an arbitrary persona.
  throw new Error("personaForIntent: no persona matches intent and no generalist fallback");
}
