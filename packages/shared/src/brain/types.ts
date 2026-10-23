/**
 * Brain protocol — the contract between the MV3 service worker, the offscreen
 * inference host, and the Dedicated Worker that owns the model.
 *
 * Model quality is gated by `scripts/brain-ab/`; this file is only the wire
 * format. It must stay runtime-agnostic: the same messages travel whether the
 * backend is WebGPU (browser) or WASM fallback, and (later) whether the
 * summarization runs in-browser or through the local Ollama channel.
 */

export type BrainBackend = "webgpu" | "wasm" | "ollama";

export type BrainTask =
  /** Strip chrome/navigation/boilerplate from a captured page. */
  | "denoise"
  /** Compress a transcript into the memory contract (mirrors @webos/actor). */
  | "summarize"
  /** Pull structured fields out of text. */
  | "extract";

export interface BrainRequest {
  id: string;
  task: BrainTask;
  input: string;
  /** Hard cap on input characters; the host truncates, it never throws. */
  maxChars?: number;
}

export type BrainProgressKind = "loading-model" | "downloading" | "ready" | "generating";

export interface BrainProgress {
  id: string;
  kind: BrainProgressKind;
  /** 0..1, present for `downloading` and `generating`. */
  progress?: number;
  /** Human-readable detail, e.g. the weight shard currently downloading. */
  detail?: string;
  backend?: BrainBackend;
}

export interface BrainResponse {
  id: string;
  ok: boolean;
  text?: string;
  error?: string;
  backend?: BrainBackend;
  elapsedMs: number;
}

/** Probe whether a backend is usable, without loading the model. */
export interface BrainProbeResult {
  ok: boolean;
  backends: BrainBackend[];
  active: BrainBackend | null;
  reason?: string;
}

export type BrainMessage =
  | { type: "webos.brain.request"; payload: BrainRequest }
  | { type: "webos.brain.progress"; payload: BrainProgress }
  | { type: "webos.brain.response"; payload: BrainResponse };

const TASKS: readonly BrainTask[] = ["denoise", "summarize", "extract"];
const BACKENDS: readonly BrainBackend[] = ["webgpu", "wasm", "ollama"];

export function isBrainTask(value: unknown): value is BrainTask {
  return typeof value === "string" && (TASKS as readonly string[]).includes(value);
}

export function isBrainBackend(value: unknown): value is BrainBackend {
  return typeof value === "string" && (BACKENDS as readonly string[]).includes(value);
}

export function isBrainRequest(value: unknown): value is BrainRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    isBrainTask(record.task) &&
    typeof record.input === "string" &&
    (record.maxChars === undefined || typeof record.maxChars === "number")
  );
}

export function isBrainProgress(value: unknown): value is BrainProgress {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.kind === "string" &&
    (record.progress === undefined || typeof record.progress === "number") &&
    (record.detail === undefined || typeof record.detail === "string") &&
    (record.backend === undefined || isBrainBackend(record.backend))
  );
}

export function isBrainResponse(value: unknown): value is BrainResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.ok === "boolean" &&
    (record.text === undefined || typeof record.text === "string") &&
    (record.error === undefined || typeof record.error === "string") &&
    (record.backend === undefined || isBrainBackend(record.backend)) &&
    typeof record.elapsedMs === "number"
  );
}

export function isBrainMessage(value: unknown): value is BrainMessage {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  switch (record.type) {
    case "webos.brain.request":
      return isBrainRequest(record.payload);
    case "webos.brain.progress":
      return isBrainProgress(record.payload);
    case "webos.brain.response":
      return isBrainResponse(record.payload);
    default:
      return false;
  }
}
