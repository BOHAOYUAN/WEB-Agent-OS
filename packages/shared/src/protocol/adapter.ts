import { DEEPSEEK_COMPLETION_PATH } from "../constants.js";
import type { NormalizerFactoryOptions, SiteAdapter, StreamNormalizer } from "../types/adapter.js";
import { DeepSeekNormalizer } from "./deepseek.js";

export const deepSeekAdapter: SiteAdapter = {
  id: "deepseek",
  displayName: "DeepSeek",
  matches(url: URL): boolean {
    return url.hostname === "chat.deepseek.com" || url.hostname === "localhost" || url.hostname === "127.0.0.1";
  },
  isCompletion(url: URL): boolean {
    return url.pathname === DEEPSEEK_COMPLETION_PATH;
  },
  createNormalizer(options: NormalizerFactoryOptions): StreamNormalizer {
    return new DeepSeekNormalizer(options);
  },
};
