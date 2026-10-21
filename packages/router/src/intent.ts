/**
 * Intent classification for the Router.
 *
 * Step 2 keeps this deliberately simple and fully deterministic: a set of
 * ordered keyword rules over the user's raw text. This is a pure function so it
 * can be unit-tested and later swapped for a local model (the WebGPU moat in
 * P5) without touching callers.
 */

export type Intent =
  | "code"
  | "finance"
  | "writing"
  | "research"
  | "general";

export interface IntentResult {
  intent: Intent;
  /** Confidence in [0, 1]. Rules are boolean today, so this is 0 or 1. */
  confidence: number;
  /** The strongest keyword that matched, for audit/traceability. */
  matchedBy: string | null;
}

export interface IntentRule {
  intent: Intent;
  keywords: string[];
}

/**
 * Ordered rules. The first rule whose keywords match wins, so put the most
 * specific / highest-priority intents first. Lowercase matching only.
 */
export const DEFAULT_INTENT_RULES: readonly IntentRule[] = [
  {
    intent: "code",
    keywords: [
      "代码", "写代码", "编程", "函数", "算法", "debug", "调试", "bug",
      "代码狂魔", "重构", "refactor", "单元测试", "typescript", "python",
      "react", "vite", "npm", "package.json", "接口", "api", "正则", "regex",
    ],
  },
  {
    intent: "finance",
    keywords: [
      "财务", "股票", "基金", "投资", "估值", "现金流", "财报", "毛利率",
      "净利润", "营收", "估值模型", "dcf", "汇率", "理财", "资产", "负债",
    ],
  },
  {
    intent: "writing",
    keywords: [
      "写作", "文案", "润色", "改写", "翻译", "公众号", "演讲稿", "口播",
      "标题", "大纲", "扩写", "缩写", "proofread", "校对",
    ],
  },
  {
    intent: "research",
    keywords: [
      "调研", "搜索", "查一下", "对比", "综述", "论文", "文献", "资料",
      "总结一下", "research", "source", "引用",
    ],
  },
] as const;

/**
 * Classify raw user text into an intent using the ordered rule list.
 * Unknown/empty text falls back to "general" with confidence 0.
 */
export function classifyIntent(
  text: string,
  rules: readonly IntentRule[] = DEFAULT_INTENT_RULES,
): IntentResult {
  const normalized = text.toLowerCase();
  if (normalized.trim().length === 0) {
    return { intent: "general", confidence: 0, matchedBy: null };
  }

  for (const rule of rules) {
    for (const keyword of rule.keywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        return { intent: rule.intent, confidence: 1, matchedBy: keyword };
      }
    }
  }

  return { intent: "general", confidence: 0, matchedBy: null };
}
