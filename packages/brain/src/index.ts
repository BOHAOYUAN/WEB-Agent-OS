/**
 * Brain layer — browser-local inference (WebGPU, WASM fallback).
 *
 * Contract lives in `@webos/shared/src/brain/types.ts`; prompts live here.
 * The runtime host (offscreen document + Dedicated Worker) is P7 stage 2 and
 * is NOT implemented yet — this package currently ships the prompts only, so
 * the model A/B gate can measure them without the MV3 plumbing.
 */

export * from "./prompts.js";
