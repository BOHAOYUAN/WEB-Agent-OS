# 自动总结触发（Auto-summary trigger）设计

> 状态：设计稿（未实现）。目标功能：记忆闭环从「手动点总结」变成「每 N 轮自动总结」，但**保存仍需人工确认**。
> 相关契约：`packages/shared/src/types/messages.ts`、`packages/shared/src/constants.ts`、`apps/extension/src/background.ts`、`apps/extension/src/sidepanel.ts`、`apps/extension/src/actor-ui.ts`。

## 1. 目标与非目标

**目标**

- 每完成 3 轮对话（或累计 ≥1200 字符）自动执行「读取当前对话 → 总结」，把结果放进记忆预览；
- 用户仍然手动点「保存到记忆」与「注入下一轮」；
- 默认关闭（opt-in），开关与阈值存在 `chrome.storage.local`。

**非目标**

- 不自动保存、不自动注入（隐私红线）；
- 不引入新的模型调用（复用 Actor 的 `memory-summary`）；
- 不做跨标签页聚合、不做滚动合并（留给后续）。

## 2. 触发规则

| 规则 | 值 | 说明 |
| --- | --- | --- |
| 轮数阈值 | 3 | 收到 `sensor.stream.end` 且该轮有 user prompt 才计数 |
| 字符阈值 | 1200 | 累计 transcript 字符数达到也触发 |
| 去抖 | 60s | 同一 tab 60 秒内最多触发一次 |
| 总结中 | 不触发 | 上一次总结未结束时忽略新事件 |
| 开关 | 默认关 | 关闭时立即清零计数 |

计数只存在 Service Worker 内存（与 ring buffer 同生命周期），**不落盘**。页面刷新 / 标签关闭即归零。

## 3. 数据流

```text
sensor.stream.end（含 user prompt）
  → background：per-tab 计数 + 字符数（复用 ring buffer 的统计）
  → 达到阈值 → port 发 webos/memory.auto-triggered { tabId, turns, chars }
  → sidepanel：读取 transcript（memory.transcript.request）
  → Actor memory-summary
  → 写入记忆预览（不保存）→ 提示「已自动总结，确认后保存」
```

## 4. 接口改动

| 位置 | 改动 |
| --- | --- |
| `packages/shared/src/types/messages.ts` | 新增 `webos/memory.auto-triggered`（background → panel，带 tabId/turns/chars） |
| `packages/shared/src/constants.ts` | 新增 `LIMITS.autoSummaryTurns / autoSummaryMinChars / autoSummaryDebounceMs`；`CHANNELS.memoryAutoSummaryStorageKey` |
| `apps/extension/src/background.ts` | 记录每 tab 的完成轮次与字符数；达到阈值时投递消息；清理 tab 时重置 |
| `apps/extension/src/sidepanel.ts` | 监听 `auto-triggered`；调用既有 summarize 流程；失败只提示不重试 |
| `apps/extension/src/actor-ui.ts` | 记忆面板加「自动总结」开关与阈值显示 |
| Actor 协议 | **不改**（复用 `memory-summary`） |

## 5. 失败模式

| 场景 | 行为 |
| --- | --- |
| Ollama 挂了 / 超时 | 面板提示「自动总结失败」，保留手动按钮；60s 后才允许下次自动尝试 |
| transcript 为空 | 不触发，计数保留 |
| 页面刷新 | 计数归零（预期） |
| 多窗口同一 tab | 以 tabId 为准，天然去重 |
| 开关中途关闭 | 立即清零，不再触发 |
| 用户手动总结中 | 自动触发跳过，避免并发 |

## 6. 测试

- 单测（`apps/extension/test/`）：阈值触发、字符触发、去抖、总结中跳过、关闭清空；
- 集成：`apps/demo` 合成页面连续发 3 轮 → 断言触发一次、预览有内容、**未保存**；
- 回归：`npm run verify` 全绿，且不改变现有手动流程的任何行为。

## 7. 任务拆分（预估 1 天）

| # | 任务 | 产出 | 验收 |
| --- | --- | --- | --- |
| T1 | 常量 + 消息类型 + storage key | shared 改动 + 单测 | typecheck 过 |
| T2 | background 计数与投递 | 计数正确、tab 关闭重置 | 单测覆盖阈值/去抖 |
| T3 | sidepanel 触发与错误处理 | 自动总结走通 | demo 三轮触发一次 |
| T4 | UI 开关与状态 | 记忆面板新增一行 | 关闭后不触发 |
| T5 | 全量回归 | verify + ACTOR_E2E | 全绿 |

## 8. 验收标准

1. 开启后第 3 轮自动触发一次总结，预览有结构化 JSON；
2. 第 2 轮不触发；关闭开关后永不触发；
3. 总结失败时页面发送不受影响，且只提示一次；
4. 不产生任何自动保存 / 自动注入；
5. `npm run verify` 绿，248 passed 基线不下降。
