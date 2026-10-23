# 提交拆分方案（2026-10-23）

> 状态：88 个文件未提交（44 修改 + 44 新增）。本方案只提拆分建议，**不执行**。
> 原因：另一个 WorkBuddy 会话仍在并行改动，此刻 commit 可能抓到半成品；且按你的习惯「提交前先看 diff 再拆」。

## 关键判断

**不能按功能切干净**：`background.ts`（+176）、`sidepanel.ts`（+205）、`shared/types/messages.ts`（+45）三个文件被 Artifacts 渲染、PageAct 接线、记忆系统三个功能同时改动。强行按功能拆要么拆不动，要么每个 commit 都过不了构建。

所以按**依赖顺序**分 6 层，每层提交后树仍可构建：

---

## Commit 1 — 工具链与依赖归位（chore）

先让 CI / lint / test / 构建的基础设施一致，后续所有 commit 都依赖它。

```
chore: 依赖归位 + 构建/测试基础设施修正
```

- `package.json` + `package-lock.json`（react/react-dom 移入 dependencies；新增 probe:memory / verify:* 脚本）
- `vitest.config.ts`（补 __DEV__ define，修 2 个测试文件崩掉的问题）
- `eslint.config.mjs`（.tmp-chrome-* ignore，修本地 verify 卡死）
- `.gitignore`（.tmp-runtime）
- `tsconfig.json`（@webos/page-act path）
- `scripts/arch-check.mjs`（page-act 白名单 + 网络红线）
- `scripts/build.mjs` + `scripts/build-artifact-runtime.mjs`（代码分割 + runtime 挪到 .tmp-runtime）
- `.github/workflows/verify.yml`（出货依赖树审计门禁）

## Commit 2 — shared 契约层（feat）

纯类型 + 纯函数，零运行时副作用，是后面所有功能的地基。

```
feat(shared): PageAct/Artifacts/Brain/Memory 契约与纯函数
```

- `packages/shared/src/types/page-act.ts`（新，PageAction DSL）
- `packages/shared/src/pageact/`（新，describe 文案）
- `packages/shared/src/artifacts/auto-render.ts` + `feedback.ts`（新）
- `packages/shared/src/artifacts/artifacts.ts`（extractPageActions + 渲染函数，+165）
- `packages/shared/src/brain/`（新）
- `packages/shared/src/types/{actor,memory,messages,artifacts}.ts` + `constants.ts` + `index.ts` + `util/validation.ts`（修改）
- `packages/shared/test/*`（新/改）

## Commit 3 — Actor 记忆(SQLite) + 安全加固（feat）

```
feat(actor): SQLite 持久记忆 + 审计日志 + 每连接限流
```

- `packages/actor/src/memory/{sqlite-store,migrate,types}.ts`（新）+ `builtin.ts`/`store.ts`/`summarize.ts`（改）
- `packages/actor/src/security/{audit-log,rate-limit}.ts`（新）
- `packages/actor/src/transport/server.ts`（+92）+ `cli.ts` + `index.ts`
- `packages/actor/test/*`（全部，含真实 WS 客户端 ws-client.ts）

## Commit 4 — PageAct 包 + UI 组件 + 扩展接线（feat，最大）

```
feat: PageAct 页面操控（DSL+执行器+确认+模型触发+CSV 导出）与 Artifacts 渲染重构
```

- `packages/page-act/`（新，整个包）
- `packages/brain/`（新，WebGPU 推理）
- `packages/ui/src/{dom,render-plan-text,pageact-panel}.ts`（新）+ `artifact-canvas/artifact-runtime/canvas-controller/sandbox-frame`（新）+ `artifact-panel/debug-panel/index`（改）
- `packages/ui/test/`（新）
- `apps/extension/src/{pageact-content,pageact-host}.ts`（新）
- `apps/extension/src/{background,sidepanel,sidepanel.html,sidepanel.css,actor-ui,artifact-sandbox.html}`（改）
- `apps/extension/test/*`（改/新）
- `apps/extension/manifest.json` + `manifest.dev.json`（downloads 权限 + 第三个 content script）
- `apps/demo/server.mjs` + `pageact-fixture.html`（新）
- `packages/sensor/src/main/taps/prompt-inject.ts`（改）

> 这个 commit 最大（~40 文件），但它是一个完整可运行的功能单元，拆更细反而每层都不过构建。

## Commit 5 — E2E / 探针脚本（test）

```
test: headless 端到端验证脚本（Artifacts / PageAct DOM / SQLite）
```

- `scripts/verify-artifact-runtime.ts`
- `scripts/verify-pageact-dom.ts`
- `scripts/verify-sqlite.mjs`
- `scripts/probe-memory-summary.mts`
- `scripts/brain-ab/`

## Commit 6 — 文档（docs）

```
docs: V2 架构计划 + 测试计划 + 威胁模型 + 发布清单同步
```

- `docs/v2-architecture-plan.md`
- `docs/pageact-test-plan.md`
- `docs/threat-model.md`
- `docs/prepublish-checklist.md`
- `docs/memory.md`
- `docs/brain-ab-report.md` + `docs/brain-denoise-report.md`
- `README.md`

---

## 风险（必须先看，再决定动不动手）

1. **并行会话冲突**：另一个会话若在这 6 步之间继续改 `background.ts`/`sidepanel.ts`，你的 `git add` 会把它混进来。**动手前先确认那个会话已停**，否则 commit 4 会抓到半成品。
2. **LF/CRLF 警告**：`git diff` 报了一堆 `LF will be replaced by CRLF`——这是 Windows 换行符差异，不影响内容，但会让 commit 的 diff 看起来比实际大。确认 `.gitattributes` 是否该加 `* text=auto`（本方案未含，避免额外改动）。
3. **Commit 2 与 Commit 4 有重叠文件**（`shared/types/messages.ts` 既被契约层又被 PageAct 改）：真正拆分时，`git add -p` 会很难切。若嫌麻烦，**Commit 2 与 4 可合并成一个「shared + page-act」大提交**，接受粒度粗一点。

## 建议执行顺序（一旦确认）

```bash
# 每步之后跑 npm run verify 确认树仍绿
git add <组内文件> && git commit -m "<message>"
```

或要我直接执行，回复「按方案提交」。否则等你停掉并行会话后我再动。
