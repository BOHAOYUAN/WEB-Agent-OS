# v0.1.0 — 第一个可公开的版本

> 日期：待发布（2026-10 收尾中）。定位：本地优先的开源项目（单人维护），不做商业化，不碰账号与凭证。

## 这一版包含什么

- **Sensor**：MAIN world 只读拦截 XHR + fetch，SSE 分帧、快照去重、thinking/answer 分流；opt-in 捕获用户提问。
- **Router**：关键词意图 + 5 套人设，MAX_ITERATIONS 循环护栏，运行时开关与失败回退。
- **Actor**：手写 RFC6455 WebSocket（127.0.0.1:4319）、token 握手、Origin 白名单、心跳、无 shell 命令 runner、memory-summary（本地 Ollama）与 memory-store（原子写）。
- **UI**：侧边栏调试面板 + 记忆闭环（读取 → 总结 → 预览 → 保存 → 注入 → 清空）+ Artifacts 面板。
- **Artifacts 沙箱**：识别 fenced html/svg，MV3 sandbox 页 + 嵌套 iframe（allow-scripts、永不 allow-same-origin），CSP default-src none / connect-src none，默认只渲染当前轮、可切全部。

## 验证

| 项 | 结果 |
| --- | --- |
| npm run verify（typecheck / lint / arch / 单测 / build） | 248 passed + 6 skipped / 32 files |
| 真实模型用例（ACTOR_E2E=1） | 9 passed：1 条 CLI 真实总结 + 5 条摘要质量 + 3 条协议用例，约 8-10s |
| 本地真实浏览器 E2E | 9 步主链路全 PASS，含注入 Payload 顺序「记忆 → 人设 → 原文」 |
| 真实 DeepSeek 抓流 | xhr / answer 673 / thinking 590 / 92 events（用户实测截图） |
| 真实 DeepSeek 保存+注入 | 见 docs/real-deepseek-runbook.md 的 G1-G4（发布时附截图） |

## 已知边界

- 只覆盖 DeepSeek 的一个页面版本；页面改版会让抓流失效（可用性问题，不是安全问题）。
- 记忆总结依赖本机 Ollama + qwen2.5:3b；3B 可能丢细节，保存前必须人工看预览。
- 自动总结触发、滚动合并、embedding 检索、对话 UI、多站点、DOM 全量操控都不在本版。
- 单用户、手动触发；没有遥测，也没有云端中转。

## 安装（摘要）

~~~powershell
npm ci
npm run verify
npm run build            # -> dist/
scripts\autostart.ps1    # 或手动 node dist/actor-cli.js
~~~

1. chrome://extensions 开发者模式加载 dist/；
2. autostart 拉起 Ollama + Actor，token 在 %LOCALAPPDATA%\WebOSAgent\token.txt；
3. 打开 chat.deepseek.com（用你自己的账号），侧边栏粘贴 token 连接。

## 下一步

补齐真实 DeepSeek 的 G1-G4 证据 → 5 分钟 demo → 博客与面试包 → ESP32 最小终端。
