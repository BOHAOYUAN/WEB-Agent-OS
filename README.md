# Web-OS-Agent

> 把 AI 网页端变成 Agent 的**外部中间件**。不是 Chrome 插件玩具，而是四层解耦的运行时：
> **Sensor → Router → Actor → UI**。当前已落地 **Sensor（只读抓流）→ Router（意图 + 人设注入）→ Actor（本地安全执行桥 + 本地记忆）**，并打通记忆闭环「捕获 → 总结 → 保存 → 注入下一轮」。

[![status](https://img.shields.io/badge/status-P1--P3%20core%20done-3fb950)](#路线图)
[![license](https://img.shields.io/badge/license-MIT-3fb950)](LICENSE)

---

## 这是什么

DeepSeek 等 AI 网页端已经是一个很强的模型入口，但它只是一个聊天框。Web-OS-Agent 在**你自己的浏览器**里观察页面自己发出的请求，把网页端的流式输出变成结构化事件，再交给路由层、本地执行层和 UI 层。

当前已完成三层：

- **Sensor**：可靠、可测试、可诊断地把 DeepSeek 网页端的 completion 流读出来（fetch/XHR 拦截 + SSE 分帧 + 归一化），并且证明它不碰账号鉴权。
- **Router**：本地规则引擎，识别用户意图并注入对应人设 System Prompt（带开关、`MAX_ITERATIONS` 熔断、失败回退）。
- **Actor**：本地 Node 执行桥，手写 RFC6455 WebSocket 服务端 + 可复用 token 握手 + 命令白名单（默认拒绝），安全执行本地命令；内置本地 Ollama 记忆总结 + 原子写 `memory.json` 记忆存储。

```text
DeepSeek 页面 JS
   │  XHR / fetch（页面自己发）
   ▼
MAIN world  sensor-main   document_start：只观察，不改请求
   │  raw text chunks + 白名单请求元数据
   ▼
ISOLATED    sensor-bridge  SSE 分帧 → DeepSeek 归一化 → 事件聚合
   │  chrome.runtime
   ▼
Service Worker             按 tab 环形缓冲 / storage.session
   │  port
   ▼
Side Panel                 调试面板：正文、思考、错误、原始帧导出
```

## 不是什么

- 不是 API Key 客户端（不使用官方 API Key，也不读取你的 Token/Cookie）。
- 不是反代、不是云服务、不是账号池。
- 不是"抓包工具"：只观察页面**自己发出**的请求，不代发、不重放、不绕过 PoW/鉴权。
- 当前不包含聊天 UI / WebGPU 本地模型 / 网页操控（DOM 降维）——这些在路线图的 P4/P5。

## 快速开始

要求：Node.js ≥ 22、Chrome/Edge ≥ 116。

```bash
npm ci
npm run verify        # typecheck + lint + 架构红线扫描 + 单测 + 构建
npm run build         # 开发构建，输出 dist/
npm run demo          # 本地 SSE demo：http://localhost:4318
```

加载扩展：

1. 打开 `chrome://extensions`，开启开发者模式。
2. "加载已解压的扩展程序"，选择本仓库的 `dist/` 目录。
3. 打开 `http://localhost:4318`，点击 **XHR 发送** 或 **fetch 发送**。
4. 点击工具栏扩展图标打开侧边栏，应看到 start / delta / end 事件；页面右下角有 `Web-OS Sensor · on` 徽标。

真实页面验证（需要你自己登录，**不要**把账号交给任何自动化工具）：

1. 打开 `https://chat.deepseek.com` 并登录。
2. 保持侧边栏打开，发送一条普通消息。
3. 期望：`sensor.stream.start` → 若干 `sensor.text.delta` → `sensor.stream.end(finished)`。
4. 打开页面的"深度思考"再发一条，期望 thinking 与 answer 两条通道分开。
5. 点击"导出原始帧"，检查 JSON 中不应出现 `Authorization`、Cookie、prompt、session id。

## 目录

```text
packages/shared    唯一契约层：类型、SSE 解码、DeepSeek 归一化、校验（纯 TS）
packages/sensor    MAIN world 观察钩子 + ISOLATED world 桥接
packages/router    意图规则引擎 + 人设库 + 熔断（RuleRouter）
packages/actor     本地执行桥：手写 RFC6455 WS + token 握手 + 命令白名单
packages/ui        侧边栏调试面板（React 版在 Step 4）
apps/extension     manifest / service worker / side panel 入口
apps/demo          本地 SSE mock，离线验收
docs/              架构、协议笔记、威胁模型、路线图
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `npm run verify` | 一次跑完全部质量门 |
| `npm test` | Vitest：SSE 分帧、归一化、XHR/fetch 钩子、合并、校验 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run arch` | 依赖方向 + 红线字符串扫描 |
| `npm run build` / `build:prod` | 开发 / 生产构建到 `dist/` |
| `npm run demo` | 本地 demo 服务 |

## 红线

1. **不碰鉴权**：不读 Cookie/Token/Authorization，不求解 PoW，不重放请求，不实现登录。
2. **不碰黑灰产**：单用户、单浏览器、人工触发；无账号池、无自动登录、无限流绕过、无转售。
3. **不复制/洗稿**：协议事实单独记录并标注来源；实现从零手写；MIT。
4. **不做隐身**：不伪造浏览器指纹、不隐藏注入痕迹、不规避页面检测。

## 风险声明

本项目是独立、非官方工具，操作的是**你自己已登录的浏览器会话**。网页端自动化/注入可能违反目标站点的服务条款，并可能导致账号被限制。本项目**不承诺不封号**，也不提供任何规避风控的能力。请只用你自己的账号、人工触发、自行承担风险。稳定生产请使用官方 API。

## License

MIT。见 [LICENSE](LICENSE)。
