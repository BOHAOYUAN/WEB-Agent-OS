# Security

## 报告问题

用 GitHub 的 [Private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)（仓库 Security 标签页 → Report a vulnerability）。

不要在公开 issue 里贴真实 Cookie、Token、对话内容、原始帧或截图。收到的报告会在 7 天内先确认、再修复。

## 设计约束（为什么这层能公开）

- **只读抓流**：不读 Cookie / `Authorization` / `x-hif-*` / `x-ds-pow-response`；扩展自身不发起网络请求，没有遥测、没有远程配置。
- **注入只改请求体**：只在下一轮 completion 的 `prompt` 前加一个「记忆 → 人设」前缀，一次注入只消费一次，失败不留残渣。
- **沙箱渲染**：模型输出的 HTML/SVG 跑在 manifest sandbox 页的嵌套 iframe 里，`sandbox="allow-scripts"` 且永不 `allow-same-origin`；CSP `default-src 'none'` / `connect-src 'none'`，模型输出无法外传。
- **本地回环**：Actor 只监听 127.0.0.1，token 由使用机器本地生成，Origin 白名单限定扩展 ID。
- **原文不落盘**：只把结构化摘要写入 `~/.webos-agent/memory.json`（原子写、上限 100 条 / 1MB），transcript 只活在内存 ring buffer；原始帧导出仅开发构建可用。

## 已知边界（不是漏洞）

- MAIN world 与页面共享 JS 上下文，nonce 对同源脚本可见；Step 1 的事件不触发特权动作。
- 页面改版可能导致抓流失效——这是可用性问题，不是安全问题，记录 transport 变化即可。
- 单用户、手动触发：不做多账号、不做云端中转、不做绕过站点检测。

## 不在范围内

账号安全、站点风控对抗、PoW 求解、请求重放、代理/反代方案。
