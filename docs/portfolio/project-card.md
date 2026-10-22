# 项目卡 · Web-OS-Agent

> 一页式，简历附件 / 面试开场用。四段式：问题 → 方案 → 证据 → 边界。

---

## Web-OS-Agent — 把 AI 网页端变成 Agent 运行时

**一句话**：一个四层解耦的浏览器中间件，不碰账号和凭证，把 DeepSeek 网页端变成可观测、可记忆、可执行、可沙箱渲染的 Agent 表面。

**技术栈**：TypeScript · Chrome Extension MV3 · Node.js · WebSocket · Ollama（本地模型）· Vitest

---

## 问题

- 大模型网页端（DeepSeek 等）只是一个聊天框：不能跨会话记忆、不能执行本地命令、不能安全渲染模型生成的代码。
- 想给它加能力，官方 API 拿不到网页端的思考通道和会话上下文，而直接读 Token/Cookie 有账号风险。
- 现有「浏览器自动化」方案普遍碰鉴权、重放请求，容易触发风控。

## 方案（四层，依赖单向）

```
Sensor(只读抓流) → Router(意图+人设注入) → Actor(本地安全执行+记忆) → UI(调试+记忆+沙箱)
```

1. **Sensor**：MAIN world 只读观察 XHR/fetch + SSE 分帧，ISOLATED world 桥接；绝不读凭证。
2. **Router**：规则引擎识别人设意图，注入 System Prompt（带 `MAX_ITERATIONS` 熔断、失败回退）。
3. **Actor**：手写 RFC6455 WebSocket + 可复用 token 握手 + 命令白名单（deny-by-default、无 shell、超时）；本地记忆闭环「捕获→总结→保存→注入」。
4. **UI / Artifacts**：侧边栏调试面板 + 记忆面板 + 沙箱（MV3 sandbox 页 + 双层 iframe + CSP 无网络，模型代码无法逃逸）。

## 证据

| 维度 | 数据 |
|---|---|
| 测试 | 248 passed + 6 skipped，含真实 Chrome 集成 + CSP/沙箱契约测试 |
| 真实模型 | `ACTOR_E2E=1` 真实 qwen2.5:3b 跑 9/9（含「计划不进 facts」质量评测） |
| 真实页面 | 真实 DeepSeek 抓流验证（xhr · answer 673 / thinking 590 / 92 events） |
| 架构红线 | `arch-check` 每次 build 强制依赖方向 + 扫描凭证/危险 API |

## 边界（主动声明）

- 单平台（DeepSeek）、单用户、手动触发；不是完整 OS。
- 无对话 UI；DOM 操控 / WebGPU / 多智能体未做。
- 记忆手动触发，无自动总结和 embedding 检索。
- 网页端注入可能触发目标站点风控（README 明确风险声明）。

## 一个能讲的故事

> 「测出一个单测抓不到的 bug：`iframe.srcdoc` 会继承扩展页 CSP，inline script 被静默拦截，沙箱里的 Todo 只渲染不交互。最后改成 MV3 manifest sandbox 页 + 双层 iframe，用契约测试锁死。」
