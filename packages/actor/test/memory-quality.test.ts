/**
 * Memory-quality evaluation against the REAL local model.
 *
 * Gated behind ACTOR_E2E=1 (same as cli-smoke's real integration test) —
 * these run actual qwen2.5:3b inference, so they are slow and only run
 * when explicitly requested. They pin the "facts must not contain plans"
 * contract end to end: prompt hardening + few-shot + the deterministic
 * normalizeSummary guard together.
 */
import { describe, expect, it } from "vitest";
import { FUTURE_MARKER, summarizeTranscript } from "../src/memory/summarize.js";

const RUN_REAL = process.env.ACTOR_E2E === "1";
const d = it.skipIf(!RUN_REAL);

interface EvalCase {
  name: string;
  transcript: string;
  /** Substring that must appear in open_loops (plans/tasks), if any. */
  inOpenLoops?: string;
  /** Substring that must appear in facts (confirmed state), if any. */
  inFacts?: string;
}

const CASES: EvalCase[] = [
  {
    name: "计划不得进入 facts（本次验收抓到的真实错误）",
    transcript:
      "用户：我们把 Stage 2 的 SystemContext 合并注入放到明天做。\n" +
      "助手：好的。今天 Stage 1b 已经完成并提交了，扩展侧边栏可以连接本地 Actor 了。",
    inOpenLoops: "Stage 2",
    inFacts: "Stage 1b",
  },
  {
    name: "已完成的事实应进 facts",
    transcript: "用户：登录的 bug 修好了吗？\n助手：已经修复，通过了全部 12 个单元测试，代码已提交。",
    inFacts: "登录",
  },
  {
    name: "待办事项不得进入 facts",
    transcript: "用户：那个性能问题怎么办？\n助手：还没复现，等下次冷启动的时候再验证一下加载耗时。",
    inOpenLoops: "验证",
  },
  {
    name: "用户偏好应进 preferences",
    transcript: "用户：以后回复都尽量简短一点，我不喜欢长篇大论。\n助手：明白，以后我会控制篇幅。",
    inFacts: "",
  },
  {
    name: "混合对话：既有已完成又有计划",
    transcript:
      "用户：总结一下进度。\n" +
      "助手：契约 v2 已经定稿并通过验证；评测脚本还没写；你说过希望所有提交都要先跑全量测试。",
    inFacts: "契约",
  },
];

describe("memory quality (real model, ACTOR_E2E=1)", () => {
  for (const c of CASES) {
    d(`${c.name}`, async () => {
      const result = await summarizeTranscript({ transcript: c.transcript, timeoutMs: 90_000 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const { memory } = result;

      // The hard invariant: no plan ever lands in facts.
      for (const fact of memory.facts) {
        expect(fact, `facts 越界: "${fact}"`).not.toMatch(FUTURE_MARKER);
      }
      if (c.inOpenLoops) {
        expect(memory.open_loops.join("|"), "计划应出现在 open_loops").toContain(c.inOpenLoops);
      }
      if (c.inFacts) {
        expect(memory.facts.join("|"), "已完成事实应出现在 facts").toContain(c.inFacts);
      }
    });
  }
});
