# 威胁模型（Step 1）

## 资产

- 用户的登录凭证（Cookie、Authorization、PoW 头）→ **不接触**。
- 对话正文/思考内容 → 仅在内存与用户主动导出的原始帧中出现。
- 页面完整性 → 任何扩展异常都不得影响页面。

## 对手

1. **页面自身脚本**（同源）：可以读取我们写在 `documentElement.dataset` 的 nonce，从而伪造 `postMessage`。
2. **恶意页面/第三方脚本**：可能尝试污染 DOM、伪造流事件、触发扩展异常。
3. **本地其他进程**：Step 1 没有本地 socket，不存在该攻击面。
4. **供应链**：依赖包被投毒。

## 控制

| 风险 | 控制 |
| --- | --- |
| 伪造 bridge 消息 | `event.source === window`、同源、nonce、pageSessionId、字段 schema、批量上限；本步事件不触发任何特权动作 |
| 凭证泄漏 | 不读 header/Cookie/localStorage；请求体只取两个布尔；`arch-check` 扫描禁用字符串 |
| XSS | 侧边栏只用 `textContent`；不渲染 markdown、不 `innerHTML`、不加载远程资源 |
| 页面被扩展拖死 | 所有钩子 `try/catch`；异常只产生 `sensor.error`；观察失败不阻塞页面请求 |
| 数据外传 | 扩展自身不发起任何网络请求（UI/SW/桥接均无 fetch/WebSocket；`arch-check` 强制） |
| SW 状态丢失 | bridge 持有归一化状态；ring buffer 落 `storage.session`；快照标注 gap |
| 供应链 | 锁定 `package-lock.json`；依赖少而明确；CI 只跑 `npm ci` |

## 残余风险

- nonce 对同源页面可见，页面理论上能伪造事件；Step 1 的事件只用于展示，不触发执行。Actor 阶段必须引入**用户确认**，不能仅凭页面内容执行命令。
- 原始帧可能包含对话内容；导出前由用户自行检查，`docs/captures/` 默认 gitignore。
- 网页端 ToS 风险不在技术控制范围内。
