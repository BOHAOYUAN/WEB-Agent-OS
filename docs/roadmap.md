# 路线图

| 阶段 | 模块 | 交付 | 验收 | 状态 |
| --- | --- | --- | --- | --- |
| **P1** | Sensor | 只读抓流、SSE 归一化、调试面板、demo、单测 | `npm run verify` + 真实页面一次完整流 | ✅ 完成（真实 DeepSeek 页面验证过） |
| **P2** | Router | 意图规则、人设注入实验（开关/回退）、`MAX_ITERATIONS=5`、停止条件、审计日志 | 注入失败不影响页面；循环可硬停 | ✅ 完成（headless E2E 验证注入生效） |
| **P3** | Actor | 本地 Node WebSocket、握手 token、命令白名单/黑名单、超时、心跳 | 恶意命令被拒；断线重连 | ✅ 完成（已接入 extension：sidepanel WS + token） |
| **P4** | UI/Render | 对话 UI、思维链渲染、Artifacts iframe 沙箱（`allow-scripts` 无 `allow-same-origin`） | XSS/沙盒逃逸测试 | 🟡 部分完成：Artifacts 沙箱已交付（MV3 sandbox 页 + 嵌套 iframe + CSP 契约测试，见 docs/artifacts-demo.md）；对话 UI / 思维链渲染按决策延后 |
| **P5** | 护城河 | WebGPU 本地小模型降噪、DOM 操控、多智能体 | 与主线 ROI 对比后再投入 | ⏳ 待做 |
| **P6** | 记忆系统 | 工作记忆（多轮指代）/ 长期记忆（用户画像）/ 情景记忆（本地小模型摘要） | 跨轮指代正确；画像注入不超限 | 🚧 进行中（Stage 2 闭环已通：捕获→总结→保存→注入；真实 DeepSeek 保存+注入待验收，自动触发仍 backlog） |

> P3 Actor 已通过 sidepanel WebSocket 接入 extension（Stage 1b）；P6 记忆系统 Stage 2 闭环（SystemContext 合并注入 + opt-in 用户提问捕获 + Actor memory-store）已完成，待真实 Chrome 验收。

## 每阶段的"30% 表达训练"产出

- 一篇架构说明（为什么这样拆、失败模式是什么）；
- 一段 5 分钟 demo 录屏（从触发到结果）；
- 一页面试可讲的 trade-off（性能、风险、替代方案）。

## 非目标

- 不做账号系统/登录/PoW/Token 管理；
- 不做云端中转或反代；
- 不追求"隐身"或绕过站点检测；
- 不在 P1 做请求改写。
