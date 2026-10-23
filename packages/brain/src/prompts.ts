/**
 * Brain task prompts.
 *
 * Kept separate from the transport contract (`@webos/shared/src/brain/types.ts`)
 * so prompts can be versioned and A/B tested without touching the wire format.
 *
 * Design constraint learned from the memory gate: small models (1.5B) will
 * happily ignore "max N items / max M chars" instructions and copy the input
 * verbatim. Prompts therefore restate the limit right next to the field, and
 * the caller still truncates — prompt compliance is never trusted.
 */

export const DENOISE_SYSTEM_PROMPT = [
  "你是一个网页正文提取器，服务于浏览器里的 AI Agent。",
  "输入是一段从网页抓取的带噪声文本，包含导航、侧栏、广告、推荐位、版权声明、评论区。",
  "你的任务是去掉噪声，只保留正文。",
  "规则：",
  "- 不要改写正文的意思，保留关键数字、代码、路径、命令行。",
  "- 不要新增任何输入里没有的内容。",
  "- 去掉：导航菜单、面包屑、登录注册入口、广告、相关推荐、热门榜单、版权声明、评论区、脚注链接。",
  "- 输出严格 JSON，不要 Markdown，不要解释。",
].join("\n");

export const DENOISE_OUTPUT_SHAPE = {
  title: "",
  body: "",
  dropped: [],
} as const;

/** Head-room for the JSON envelope; input is hard-capped by the caller. */
export const DEFAULT_DENOISE_MAX_CHARS = 8 * 1024;

export interface DenoiseResult {
  title: string;
  body: string;
  dropped: string[];
}

export function buildDenoisePrompt(input: string, maxChars: number = DEFAULT_DENOISE_MAX_CHARS): string {
  const clipped = input.length > maxChars ? input.slice(0, maxChars) : input;
  return [
    "请把下面这段网页文本降噪，严格输出以下 JSON 结构：",
    JSON.stringify(DENOISE_OUTPUT_SHAPE, null, 2),
    "",
    "字段规则：",
    "- title：网页正文标题，不超过 30 个汉字；没有就给空字符串。",
    "- body：降噪后的正文，纯文本，不超过 800 个汉字。必须是压缩后的正文，绝不能整段照抄输入。",
    "- dropped：你去掉的噪声类别，最多 5 条，每条不超过 10 个汉字（例如「导航栏」「相关推荐」）。",
    "所有数组只能包含字符串。只输出 JSON。",
    "",
    "网页文本：",
    clipped,
  ].join("\n");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Parse a denoise response. Throws on anything that is not the agreed shape. */
export function parseDenoiseOutput(content: string): DenoiseResult {
  const cleaned = content
    .trim()
    .replace(/^\u0060\u0060\u0060(?:json)?\s*/i, "")
    .replace(/\s*\u0060\u0060\u0060$/i, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("模型没有返回 JSON");
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  const dropped = Array.isArray(parsed.dropped)
    ? parsed.dropped.filter((item): item is string => typeof item === "string").slice(0, 5)
    : [];
  return {
    title: asString(parsed.title).slice(0, 60),
    body: asString(parsed.body).slice(0, 3000),
    dropped,
  };
}
