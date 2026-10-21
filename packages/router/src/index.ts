import { MAX_ITERATIONS } from "@webos/shared";
import type { SensorEvent } from "@webos/shared";
import { classifyIntent } from "./intent.js";
import { personaForIntent } from "./persona.js";
import { LoopGuard } from "./loop-guard.js";

export interface RouterContext {
  tabId: number;
  pageSessionId: string;
}

export type RouterDecision =
  | { kind: "noop" }
  | { kind: "send-prompt"; prompt: string; reason: string }
  | { kind: "stop"; reason: "max-iterations" };

export interface RouterConfig {
  /**
   * Master switch. Injection is OFF by default so Step 1 read-only behaviour is
   * preserved until the operator explicitly enables the Router.
   */
  enabled?: boolean;
  /** If true, also emit persona decisions for the fallback "general" intent. */
  injectGeneral?: boolean;
  maxIterations?: number;
}

export interface Router {
  onSensorEvent(event: SensorEvent, context: RouterContext): RouterDecision;
  /** Toggle the master switch at runtime. Disabling resets the current turn. */
  setEnabled(enabled: boolean): void;
  resetTurn(): void;
}

/**
 * The Router is a deterministic rules engine. It only computes decisions — it
 * never performs injection itself. The apps/extension layer applies a
 * "send-prompt" decision, which keeps this package free of chrome.* / DOM APIs
 * (enforced by scripts/arch-check.mjs).
 */
export class RuleRouter implements Router {
  private readonly injectGeneral: boolean;
  private readonly loopGuard: LoopGuard;
  private enabled: boolean;
  private emittedThisTurn = false;
  private intentCache: { intent: ReturnType<typeof classifyIntent>["intent"] } | null = null;

  constructor(config: RouterConfig = {}) {
    this.enabled = config.enabled ?? false;
    this.injectGeneral = config.injectGeneral ?? false;
    this.loopGuard = new LoopGuard({ maxIterations: config.maxIterations ?? MAX_ITERATIONS });
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.resetTurn();
  }

  onSensorEvent(event: SensorEvent, _context: RouterContext): RouterDecision {
    // The loop guard is hard: it applies even when injection is disabled, so a
    // runaway turn can always be observed and stopped.
    if (event.type === "sensor.stream.end") {
      this.resetTurn();
      return { kind: "noop" };
    }

    if (!this.enabled) return { kind: "noop" };

    if (event.type === "sensor.text.delta" && event.channel === "answer") {
      return this.handleDelta(event.text);
    }

    return { kind: "noop" };
  }

  resetTurn(): void {
    this.loopGuard.reset();
    this.intentCache = null;
    this.emittedThisTurn = false;
  }

  private handleDelta(text: string): RouterDecision {
    if (text.trim().length === 0) return { kind: "noop" };

    if (!this.intentCache) {
      const result = classifyIntent(text);
      this.intentCache = { intent: result.intent };
    }

    const intent = this.intentCache.intent;
    if (intent === "general" && !this.injectGeneral) {
      return { kind: "noop" };
    }

    // Emit at most once per turn. The first delta that resolves an intent arms
    // the persona; every later delta of the same turn is a no-op. This prevents
    // delta-level arm/disarm flapping and hundreds of redundant IPC messages.
    if (this.emittedThisTurn) return { kind: "noop" };

    const decision = this.loopGuard.tryEmit();
    if (!decision.allowed) {
      return { kind: "stop", reason: "max-iterations" };
    }

    this.emittedThisTurn = true;
    const persona = personaForIntent(intent);
    return {
      kind: "send-prompt",
      prompt: persona.systemPrompt,
      reason: `intent=${intent} persona=${persona.id}`,
    };
  }
}

export { MAX_ITERATIONS };
export { classifyIntent, DEFAULT_INTENT_RULES } from "./intent.js";
export type { Intent, IntentResult, IntentRule } from "./intent.js";
export { personaForIntent, DEFAULT_PERSONAS } from "./persona.js";
export type { Persona } from "./persona.js";
export { LoopGuard } from "./loop-guard.js";
export type { LoopGuardDecision, LoopGuardOptions } from "./loop-guard.js";
