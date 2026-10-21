import type { EndReason, SensorEvent } from "./events.js";

export interface StreamNormalizer {
  pushData(data: string): void;
  end(reason: EndReason): void;
}

export interface NormalizerFactoryOptions {
  requestId: string;
  thinkingEnabled: boolean;
  emit: (event: SensorEvent) => void;
  now?: () => number;
}

export interface SiteAdapter {
  id: string;
  displayName: string;
  /** Whether this adapter claims the page origin. */
  matches(url: URL): boolean;
  /** Whether this request is the adapter's completion stream. */
  isCompletion(url: URL): boolean;
  createNormalizer(options: NormalizerFactoryOptions): StreamNormalizer;
}
