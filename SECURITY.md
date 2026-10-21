# Security

## 报告

请通过仓库 issue（不要公开敏感细节）或维护者邮箱报告。不要在 issue 里贴真实 Cookie、Token、对话内容或原始帧。

## 设计约束

- 扩展不读取 Cookie、Authorization、`x-hif-*`、`x-ds-pow-response`。
- 扩展自身不发起网络请求；没有遥测、没有远程配置。
- 原始帧导出仅开发构建可用，默认不落盘。
- 调试 UI 只使用 `textContent`，不执行模型输出。

## 已知边界

- MAIN world 与页面共享 JS 上下文，nonce 对同源脚本可见；Step 1 的事件不触发特权动作。
- 页面改版可能导致抓流失效；这是可用性问题，不是安全问题。
