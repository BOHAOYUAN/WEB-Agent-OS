# 端到*端验证指南（E2E Verification）*

> *目标：把*"120 个全绿的单测"变成"真实页面上一次可见的完整流"。  
> 顺序：**先本地 demo 排障 → 再真实 DeepSeek 见血**。不要跳过第一步。



---

## 0. 一句话结论（成功长什么样）

- **Sensor 成功** = 侧边栏出现一张「会话卡片」，卡片上显示 `fetch`/`xhr` 标签、`answer N chars · thinking N chars`，且「查看事件」里能看到 `text.delta` 一行行滚出来。
- **Router 成功** = 打开「人设注入」开关后，侧边栏的事件流里能看到一条 `send-prompt` 决策（通过 background 的 Service Worker 控制台观察，或看下一条消息是否带上了人设）。

**注意：主要观察窗口是「侧边栏」，不是页面 Console。** 代码里几乎没有 console 日志，唯一一条是 dev 构建下 `[webos-sensor] installed at <url>`。

---

## 1. 加载扩展（一次性操作）

1. 确保已 `npm run build`（产物在 `E:/project/Web-OS-Agent/dist/`）。
2. 打开 Chrome，地址栏输入 `chrome://extensions`。
3. 右上角打开 **「开发者模式」**。
4. 点 **「加载已解压的扩展程序」**，选中 **`dist` 目录**（不是 packages、不是 apps，就是 `dist`）。
5. 看到卡片 **「Web-OS-Agent Sensor (dev)」** 即成功。

> 关键：`dist/manifest.json` 是 dev 版（同时匹配 `chat.deepseek.com` 和 `localhost:4318`）。如果哪天用了 `npm run build --prod`，就不会匹配 localhost 了，demo 会失效。

---

## 2. 第一步：本地 demo（零风险排障）

**目的**：验证"扩展装对了 + 链路通"，不碰真实账号，不担任何风险。

1. 确认 demo server 在跑：浏览器打开 `http://localhost:4318`，能看到「Web-OS-Agent · local SSE demo」页面。（如果打不开，终端跑 `npm run demo`。）
2. 点扩展图标，打开 **侧边栏**（chrome.sidePanel 默认绑定 action 点击）。
3. 回到 demo 页，点 **「XHR 发送」** 按钮。
4. 观察侧边栏：应该出现一张会话卡片，`transport = xhr`，`answer 13 chars`（"你好，世界！…" 那串），`thinking 7 chars`（"思考：先读取问题。"）。
5. 再点 **「fetch 发送」**，应该出现第二张卡片，`transport = fetch`。
6. 点 **「截断模式」**，卡片状态应该是 `aborted`/`transport-closed` 而非 `finished`——这验证了 SSE 截断处理。

**这一步全通过，说明 Sensor 链路（拦截 → 分帧 → 归一化 → 侧边栏）在真实浏览器里是通的。** 剩下就是上真实 DeepSeek。

---

## 3. 第二步：真实 DeepSeek（见血）

1. 打开 `https://chat.deepseek.com`，登录**你自己的账号**（红线：只用自己的账号，不碰任何第三方登录/代登录）。
2. 打开侧边栏，确认状态是「已连接」或「等待页面流…」。
3. 在 DeepSeek 里发一条消息，比如：**「用 Python 写一个快速排序」**。
4. 观察侧边栏：
   - 出现会话卡片，`transport = fetch`（DeepSeek 用 fetch 而非 XHR）。
   - `answer` 字符数随回答流持续增长。
   - 如果 DeepSeek 开了「深度思考」，`thinking` 字符数也会增长。
   - 流结束，卡片状态变 `finished`。
5. 打开卡片的「查看事件」，应看到：
   - `stream.start` → `text.delta (answer)` × N → `stream.end`

**这一步通过 = P1 验收项「真实页面一次完整流」达成。** 这是你从"写作业"到"造中间件"的历史性瞬间。

---

## 4. 验证 Router（应答驱动，先理解时序）

Router 是**应答驱动**：它分析的是 DeepSeek **回答流**的文本，不是你的提问。

1. 在侧边栏勾选 **「人设注入（下一轮生效）」**。
2. 发一个会让 DeepSeek **输出大量代码/技术词**的问题，如「帮我用 TypeScript 写一个防抖函数」。
3. Router 在回答流里匹配到 code 意图后，会发 `send-prompt` 决策 → arm 注入。
4. **下一条消息**才会真正带上"代码狂魔"人设（这是方案 A 的固有代价，不是 bug）。

**观察 Router 决策的方法**（因为侧边栏不直接显示 Router 决策）：

- 打开 `chrome://extensions` → 找到本扩展 → 点 **「Service Worker」**（或「检查视图：Service Worker」）→ 在 Service Worker 控制台里看有没有 arm 相关日志。
- 或：发完第一条技术问题后，再发一条，看 DeepSeek 回答风格是否明显偏向"代码狂魔"人设。

---

## 5. 如果页面崩了 / 白屏（排查步骤）

注入默认关闭，所以白屏大概率不是注入导致。用**二分法**定位：

1. **先关注入开关**（或直接禁用扩展）→ 刷新 DeepSeek → 是否恢复？
   - 恢复 → 是注入的问题，回退到"原样发请求"，记录复现步骤。
   - 没恢复 → 不是注入，继续第 2 步。
2. **禁用扩展**（chrome://extensions 里关掉开关）→ 刷新 → 是否恢复？
   - 恢复 → 是扩展的 content script 干扰了页面，重点看 `sensor-main.js` 的 DOM 注入。
   - 没恢复 → 是 DeepSeek 页面自己的问题（CSP 更新、网络等），跟本项目无关。
3. **看报错**：
   - 页面 Console：`F12` → Console，看有没有我们注入导致的 JS 报错。
   - Service Worker 控制台：`chrome://extensions` → 扩展 → Service Worker，看 background 有没有报错。
4. **最坏情况**：`chrome://extensions` 里点「重新加载」扩展，或移除后重新「加载已解压」，清掉脏状态。

> 排查原则：Sensor 是「只读 + clone」，理论上不可能崩页面；注入是「只改 body、try/catch 兜底」，失败原样发请求。所以**真正的白屏应该先怀疑环境/官方更新，而不是自己的代码**——但要用二分法证明。

---

## 6. 红线提醒（验证时也要守住）

- 只用**自己的** DeepSeek 账号，不碰代登录/多账号/PoW。
- 不导出真实对话的原始帧外发（调试面板的「导出原始帧」仅 dev 构建有，导出前自查是否含敏感内容）。
- 不尝试绕过站点的反爬/检测，本项目是"增强"不是"破解"。

---

## 7. Stage 2 记忆闭环验收

> **代码验收：ACCEPT PASS（2026-10-22）**
> 环境：真实 Chrome + 真实扩展 + 真实本地 Actor + 真实 Qwen2.5-3B + 本地合成页面。
> **不是真实 DeepSeek 页面**——那一步需用户本人登录，见 7.4。

### 7.1 主链路验收清单（9 步全 PASS）

| 步骤 | 操作 | 通过标准 |
|---|---|---|
| 1 | 勾选「允许捕获用户提问」 | capture.set 生效，content 开始发 `sensor.user.prompt` |
| 2 | 发送第一条消息 | SW ring buffer 捕获 user prompt |
| 3 | 「读取当前对话」 | user + assistant 按 requestId 正确配对，turns / chars 正确 |
| 4 | 「总结当前对话」 | `memory-summary` 返回 `ok:true`，真实本地模型出结构化摘要 |
| 5 | 预览 | 显示字符数，≤ `MAX_MEMORY_INJECT_CHARS`(600) 上限 |
| 6 | 「保存到记忆」 | `memory.json` 写入 entry，`source` 非空（`tabId` / `pageSessionId` / `turnCount`） |
| 7 | 「注入下一轮」+ 第二条消息 | 请求体合并前缀顺序「记忆 → 人设 → 原文」，单前缀、不互相覆盖、一次消费 |
| 8 | 「读取已保存记忆」 | 读回 entry |
| 9 | 「清空并停止捕获」 | 磁盘文件删除 + 本地 transcript 清空（0 轮）+ 捕获开关关闭 + 待注入 memory 被 disarm |

### 7.2 关键实测证据（真实扩展，非单测推断）

- 捕获：`1 轮 · 71 字符`，user + assistant 配对正确。
- 总结：`ok:true`，`4018ms`，真实 `qwen2.5:3b`。
- P2 source：`{ tabId: 2068909093, pageSessionId: "dd8df7a2-…", turnCount: 1 }`，三字段完整落盘。
- 注入：第二条请求体顺序「记忆 → 人设 → 原文」，2 个 `---` 分隔，`personaIdx=31` / `originalIdx=251`；第一条请求为原始 prompt、无注入。
- P1 清空：提示「已清空…捕获已关闭」；捕获勾选变 false；文件删除；transcript 变空；清空后读取显示「没有可读取的对话…」。

### 7.3 收尾修复（P1 / P2）

- **P1 — 清空记忆没清已捕获 transcript**：新增 `webos/memory.clear-captured` 消息。点「清空并停止捕获」除删 `memory.json` 外，同时清空该 tab 的 ring buffer、关闭捕获（`memory.set-capture enabled:false`）、`inject.disarm target:"memory"` 清掉待注入状态；清空后再「读取当前对话」返回 0 轮 / 空。
- **P2 — 保存的 entry 丢 `source`**：`onSaveMemory(memory, model, source)` 补上 source 入参，sidepanel 把最近一次 transcript 响应的 `{tabId, pageSessionId, turnCount}` 传下并随 `memory-store save` 落盘，溯源不再丢。

### 7.4 回归 + 剩余边界（Stage 2 尚未完全关闭）

- 回归：`npm run verify` 全绿 typecheck / lint / arch / **214 passed + 6 skipped** / build。
- **技术闭环已关闭**，但「真实 DeepSeek 记忆闭环」还差最后一步，须用户本人完成（不碰第三方账号）：
  1. 登录 DeepSeek，开捕获，发 3 次真实技术对话；
  2. 每次：读取 → 总结 → 保存 → 注入 → 看回答是否真用上记忆；
  3. 记录 3 条摘要质量问题（如有）。
- 另需 2 小时 ownership audit：不看代码讲清「捕获 → transcript → 总结 → source → 合并注入 → 清空」这条链。
- 以上两件做完，Stage 2 才算真正关闭；自动触发继续留在 backlog。
