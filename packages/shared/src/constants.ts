export const PROTOCOL_VERSION = 1 as const;
export const EXTENSION_NAME = "Web-OS-Agent";

/** Only this endpoint is treated as a chat completion stream in step 1. */
export const DEEPSEEK_COMPLETION_PATH = "/api/v0/chat/completion";

/** Router loop guard. Defined here so the contract exists before Router is implemented. */
export const MAX_ITERATIONS = 5;

export const LIMITS = {
  /** Hard cap for a single SSE event buffer. */
  maxSseFrameChars: 8 * 1024 * 1024,
  /** Hard cap for one completion stream's captured characters. */
  maxStreamChars: 2_000_000,
  /** Runtime message batch limits. */
  maxBatchEvents: 500,
  maxBatchBytes: 256 * 1024,
  /** Concurrent completion streams per page. */
  maxConcurrentStreams: 4,
  /** Delta coalescing in the bridge. */
  coalesceWindowMs: 16,
  coalesceMaxChars: 64,
  /** Bridge -> service worker batching. */
  bridgeFlushMs: 32,
  bridgeFlushEvents: 64,
  /** Service worker ring buffer per tab. */
  ringMaxEvents: 4_000,
  ringMaxChars: 1_500_000,
  /** Raw capture ring in the content bridge (dev only). */
  rawMaxFrames: 2_000,
  rawMaxChars: 2_000_000,
  rawFrameMaxChars: 256 * 1024,
  /** Router persona injection: how long an armed prompt stays pending before expiring. */
  injectArmTtlMs: 5 * 60 * 1000,
  /** Upper bound on an injected persona prompt, to keep the rewrite tiny. */
  maxInjectPromptChars: 4_000,
} as const;

export const CHANNELS = {
  mainSource: "webos.sensor.main",
  bridgeSource: "webos.sensor.bridge",
  uiPort: "webos:ui",
  storageKey: "webos:ring:v1",
  routerStorageKey: "webos:router:v1",
  /** Side panel's Actor bridge token (session-scoped storage, cleared on restart). */
  actorTokenStorageKey: "webos:actor:token:v1",
  /** Opt-in user-prompt capture flag (local storage, persists across restarts until cleared). */
  memoryCaptureStorageKey: "webos:memory:capture-user:v1",
} as const;
