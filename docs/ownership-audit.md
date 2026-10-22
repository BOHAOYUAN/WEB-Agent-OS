# Ownership audit：不看代码讲清记忆闭环

> 用法：先把代码藏起来，按 1–7 段顺序讲，每段 2 分钟、总长 ~15 分钟；然后用第 8 节的 20 问自测，答不上来的段落回到代码里重看。  
> 判据：能讲清「为什么这么设计」和「失败时坏在哪」，而不只是复述文件名。

## 0. 一句话

页面自己发出的 completion 请求被只读拦下 → SSE 分帧成事件 → 按 requestId 配成对话 → 本地 3B 压成结构化记忆 → 存盘 → 下一轮把「记忆 + 人设」作为一个前缀塞回请求体。

## 1. 捕获：只观察，不改写

- **谁抓**：MAIN world 在 `document_start` 注入，包住 `XMLHttpRequest` 与 `fetch`（`packages/sensor/src/main/taps/xhr.ts` / `fetch.ts`），只读 clone，不阻断。
- **抓什么**：请求 URL + body 的「白名单字段」（`prompt`、`thinking_enabled`）与响应流；**不读** Cookie / Authorization / `x-hif-*` / PoW 头（`packages/sensor/src/main/channel.ts` 的 allowlist）。
- **用户提问**：默认关闭，勾选后才由 `prompt-inject` 的旁路 tap 发出 `sensor.user.prompt`（`taps/prompt-inject.ts`），只进内存 ring buffer。
- **事件形状**：`SensorEvent`（`packages/shared/src/types/events.ts`），带 `requestId`、`channel`（thinking / answer）、`text`。
- **失败模式**：页面改版换传输（xhr→fetch/WS）时抓不到 → 先看 Sensor Debug 的 transport 字段；SSE 任意切分错位 → `packages/shared/src/protocol/sse.ts` 的增量解码负责兜住。
- **验证**：`packages/sensor/test/xhr-reader.test.ts`、`fetch-stream.test.ts`、`sse.test.ts`、`user-prompt-tap.test.ts`。

## 2. transcript：配对与裁剪

- `buildTranscript(events, maxChars)`（`packages/shared/src/memory/transcript.ts`）把事件流变成对话文本。
- **配对规则**：按 `requestId` 把 `sensor.user.prompt` 与同 id 的 answer delta 配成一轮；thinking delta 一律忽略；只有「用户 + 非空回答」都齐的轮次才算数，孤儿 prompt 丢掉。
- **没有用户提问时**退化为 assistant-only 轮次。
- **裁剪**：只保留最近的轮次，总长不超过 `MAX_TRANSCRIPT_CHARS`，避免 3B 被长上下文拖慢。
- **验证**：`packages/shared/test/transcript.test.ts`（含乱序、去重、超长裁剪）。

## 3. 总结：小模型 + 确定性守卫

- `summarizeTranscript`（`packages/actor/src/memory/summarize.ts`）调本机 Ollama `127.0.0.1:11434`，模型 `qwen2.5:3b`，`format=json` 固定 schema：`facts / preferences / decisions / open_loops / summary`。
- **防编造三件套**：prompt 硬约束（只写已确认事实）+ few-shot + `normalizeSummary` 确定性守卫；`FUTURE_MARKER` 检查保证「计划/待办」不能落进 `facts`。
- **边界**：endpoint 强制 localhost（SSRF 守卫），默认超时 60s；返回非 JSON 直接报错，不写脏数据。
- **验证**：`packages/actor/test/summarize.test.ts` + `memory-quality.test.ts`（`ACTOR_E2E=1`，5 条真实模型断言）。

## 4. source：为什么记三字段

- 保存时写入 `{ tabId, pageSessionId, turnCount }`（`apps/extension/src/sidepanel.ts` → `memory-store save`）。
- **作用**：区分「哪一页、哪次会话、第几轮」，后续做滚动合并 / 检索时能回溯，也能避免把 A 标签页的上下文注入到 B 标签页。
- **存储**：`~/.webos-agent/memory.json`，原子写（tmp + rename），损坏文件先备份再覆盖，上限 100 条 / 1MB（`packages/actor/src/memory/store.ts`）。
- **验证**：`store.test.ts` 的原子写 / 损坏恢复 / 容量裁剪；`cli-smoke.test.ts` 的 memory-store 往返。

## 5. 合并注入：顺序、上限、一次消费

- **合并顺序固定**：`composeSystemContext`（`packages/sensor/src/main/taps/prompt-inject.ts`）先 memory 后 persona，用 `---` 分隔；空字段直接丢弃。
- **记忆文本**：`formatMemoryForPrompt`（`packages/shared/src/memory/format.ts`）按 summary → facts → preferences → decisions → open_loops 输出，按整行截断到 `MAX_MEMORY_INJECT_CHARS`（600）。
- **一次消费**：`injector-state.ts` 的 arm / peek / consume + version 校验——注入成功才清空，失败留到下一轮重试，且永远不会跨两轮重复注入。
- **验证**：`prompt-inject.test.ts`、`injector-state.test.ts`、`format.test.ts`；真实浏览器里看 Network 的 prompt 顺序（报告 §5.3）。

## 6. 清空：删什么、关什么

「清空并停止捕获」= 删 `memory.json` + 清该标签页 ring buffer（`webos/memory.clear-captured`）+ 关闭捕获 + `inject.disarm target=memory` 清掉待注入状态。
复位后「读取当前对话」返回 0 轮，注入永远不会带着已删记忆。

## 7. 边界：刻意没做的事

- 自动触发总结（按轮数/字符数）——留 backlog，先把手动闭环验证干净；
- 滚动合并与检索（embedding）——单条记忆够用，合并会引入新的质量风险；
- 原文不落盘——只存结构化摘要，transcript 只活在内 ring buffer；
- 不碰鉴权/Token/PoW——红线，也是这个项目能公开的前提。

## 8. 20 问自测

1. 为什么用 MAIN world 而不是 ISOLATED？— 只能在那里包住页面的 XHR/fetch；ISOLATED 拿不到同一份对象。
2. 为什么只读不阻断？— 阻断会破坏页面，且越权风险大；改写在「下一轮请求体」上做。
3. 抓取的 allowlist 里为什么没有 Cookie？— 红线；也避免把凭证写进任何日志/导出。
4. requestId 从哪来、为什么能配对？— 页面自己生成的请求 id，user.prompt 与 answer 共用。
5. thinking delta 为什么必须忽略？— 否则推理过程会被当成答案，摘要会污染。
6. transcript 为什么裁剪「最近」而不是「最相关」？— 没有检索时的最简正确解，成本可预期。
7. 为什么 3B 而不是 7B/1.5B？— 1.5B 丢细节，7B 慢且吃显存；3B 在这台 6GB 卡上是甜点。
8. 摘要为什么是固定 JSON schema？— 小模型最易错格式，schema + format=json 把错误挡在入口。
9. 「计划进 facts」为什么是严重错误？— 下一轮会把未发生的事当既成事实注入，模型据此继续编。
10. FUTURE_MARKER 守卫怎么工作？— 保存前对 facts 逐条做确定性匹配，命中即拒绝/清洗。
11. 为什么 summary 之外还要 facts/preferences？— 注入时按类型拼装，偏好和事实的措辞不同。
12. source 三字段分别防什么？— tabId 防跨页污染，pageSessionId 防跨会话残留，turnCount 支持回溯。
13. memory.json 为什么原子写？— 断电/并发写不能留下半截 JSON；损坏要先备份再覆盖。
14. 注入顺序为什么 memory 在 persona 前？— 记忆是「事实」，人设是「风格」；事实在前更不易被风格覆盖，且只产生一个前缀。
15. 为什么限制 600 字符？— 控制下一轮 token 成本，也防止小模型总结偶尔超长。
16. arm/peek/consume 的 version 干嘛的？— 防止旧注入被新 arm 覆盖后又被误清，以及一次注入只消费一次。
17. 注入失败会怎样？— 不清 pending，下一轮重试；不会丢，也不会重复注入两轮。
18. 清空为什么还要 disarm？— 否则已删记忆可能仍在待注入状态，被下一条消息带上。
19. 这套东西为什么不需要 API key？— 观察的是用户自己浏览器里已经发出的请求。
20. 最大的风险是什么？— 页面改版导致抓流失效（可用性），以及小模型摘要质量（已被质量用例 + 人工保存确认兜住）。

## 9. 5 分钟面试压缩版

一句话定位 → 四层拆解（每层一句）→ 演示一次「保存记忆 → 下一轮请求体里出现前缀」→ 讲两个 trade-off（不改写页面只改请求体；不碰凭证只读抓流）→ 讲两个失败模式（页面改版、3B 编造）与已有的兜底（transport 探测、FUTURE_MARKER + 人工确认）。
