/**
 * PageAct — declarative page control.
 *
 * The model may only speak the Action DSL (`dsl.ts`); the executor
 * (`executor.ts`) performs validated actions against an injected page
 * environment, and `dom-environment.ts` is the only adapter that touches a
 * real DOM.
 */

export * from "./dsl.js";
export * from "./executor.js";
export * from "./dom-environment.js";
export * from "./confirm.js";
export * from "./export.js";
