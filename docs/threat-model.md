# 威胁模型（v2：Sensor / Router / Actor / Artifacts）

> 范围：扩展本体（content script / side panel / service worker）、本地 Actor 桥接
> （`ws://127.0.0.1`）、以及沙箱内的模型产出渲染。
> 最后更新：2026-10-23（补入 Actor 桥接的握手、限流与审计轨迹）。

## 资产

- 用户的登录凭证（Cookie、Authorization、PoW 头）→ **不接触**。
- 对话正文/思考内容 → 仅在内存与用户主动导出的原始帧中出现；结构化摘要才落盘。
- 页面完整性 → 任何扩展异常都不得影响页面。
- **Actor 握手令牌**（`WebOSLocal-…`）→ 可复用；泄漏即等于交出桥接的执行权限。
- **审计轨迹** → 可导出；泄漏等于暴露「谁被拒绝过」。

## 对手

1. **页面自身脚本**（同源）：可以读取我们写在 `documentElement.dataset` 的 nonce，从而伪造 `postMessage`。
2. **恶意页面/第三方脚本**：可能尝试污染 DOM、伪造流事件、触发扩展异常。
3. **本地其他进程**：**存在该攻击面**——Actor 桥接监听 `127.0.0.1` 的 WebSocket，且令牌是可复用的。控制见下表；注意限流按连接计数，重连即可重置预算（见残余风险）。
4. **供应链**：依赖包被投毒。

## 控制

| 风险 | 控制 |
| --- | --- |
| 伪造 bridge 消息 | `event.source === window`、同源、nonce、pageSessionId、字段 schema、批量上限；本步事件不触发任何特权动作 |
| 凭证泄漏 | 不读 header/Cookie/localStorage；请求体只取两个布尔；`arch-check` 扫描禁用字符串 |
| XSS | 侧边栏只用 `textContent`；不渲染 markdown、不 `innerHTML`、不加载远程资源 |
| 页面被扩展拖死 | 所有钩子 `try/catch`；异常只产生 `sensor.error`；观察失败不阻塞页面请求 |
| 数据外传 | 扩展自身不发起任何网络请求（UI/SW/桥接均无 fetch/WebSocket；`arch-check` 强制）——**唯一例外是 sidepanel → 本机 Actor 的 WebSocket**，端点硬编码为 `127.0.0.1` |
| SW 状态丢失 | bridge 持有归一化状态；ring buffer 落 `storage.session`；快照标注 gap |
| 模型输出 = 不可信输入（Artifacts 渲染 / 自动渲染） | 沙箱 iframe 恒为 `allow-scripts`、**无** `allow-same-origin`（opaque origin，无扩展 API/存储/令牌访问）；fragment 带 meta CSP（`default-src 'none'`、`connect-src 'none'`）；代码预览只用 `textContent`；`webos.report` 回传经 `event.source` 身份校验 + 4KB 截断；自动渲染默认开但可一键关闭，UI 常驻提示 |
| **本地进程连上 Actor 桥接** | 握手须带可复用 token（`ReusableToken`）+ Origin 白名单（token-first：无 Origin 跳过 Origin 检查，有 Origin 必须命中白名单，否则一律拒绝）；令牌校验失败写审计后立即断开 |
| **单一连接打爆桥接** | 每连接**令牌桶限流**：默认 10 次/秒、突发 20、连续 5 次违规直接断连。限流在解析之前生效——被限流的帧不会进入命令路径 |
| **拒绝与执行不可追溯** | 桥接维护**审计轨迹**（内存环形缓冲，默认 500 条）：握手拒绝、令牌拒绝、畸形帧、命令被拒、命令失败、命令成功、被限流、连接关闭，逐条记录并可导出为 JSON |
| 审计轨迹泄漏敏感信息 | **记录前**统一脱敏（`WebOSLocal-*`、`token=`、`sk-*` 一律替换为 `[redacted]`），详情截断 120 字符；导出的 `audit-dump` 命令返回的是**已脱敏**的记录 |
| 供应链 | 锁定 `package-lock.json`；依赖少而明确；CI 只跑 `npm ci`；CI 对**出货依赖树**设门禁（`npm audit --omit=dev --audit-level=high`——`dependencies` 恰好等于会被编译进产物的库：react/react-dom → `artifact-runtime.js`，sucrase → `artifact-sucrase.js`） |
| **模型驱动的页面操作** | 声明式 Action DSL 六种动作（**没有任意 JS**：无 `eval`、无自由代码字段）；校验是严格字段集 + 长度/范围上限；SW 侧域名白名单；批次有动作数与翻页步数上限；**危险动作（下载/提交/凭据/删除）必须经用户显式确认才执行**，无人应答即拒绝 |
| 确认被绕过 | 执行器里「没有 confirm 回调 = 拒绝」；content script 执行前**再校验一次**（最后一道闸）；确认请求走 SW 登记，**晚到的答复不能复活**已拒绝的动作；没有面板连接时直接拒绝而不是等待 |

## 残余风险

- nonce 对同源页面可见，页面理论上能伪造事件；这些事件只用于展示，不触发执行。触发特权动作必须引入**用户确认**，不能仅凭页面内容执行命令。
- **Artifacts 自动渲染**：模型回答结束后未经额外点击即执行其生成的代码。已判定：安全边界是沙箱隔离（opaque origin + 无网络 + 无扩展访问），**不是**点击门槛——点击只是体验设计。若未来要进一步提高门槛，应做成「首次自动渲染前询问一次」，而非恢复全局点击门。
- **令牌可复用且无撤销机制**：一次泄漏长期有效，直到用户重启 Actor 并换令牌。Origin 白名单与限流都不是撤销。接受该现状的前提是桥接只监听 `127.0.0.1`。
- **限流不是防有动机的本地攻击者**：预算按连接计数，重连即重置。它防的是失控客户端与误用循环，不是能持续重连的本地进程。
- **审计轨迹是内存态**：进程退出即丢失，也无法证明未被篡改。要满足合规取证需要落盘 + 哈希链，本项目**明确不做**——那会在磁盘上新增一处隐私面，与记忆系统的「原始对话永不落盘」原则冲突。审计的定位是「当场可查」，不是「事后取证」。
- **开发工具链存在 6 个已知告警**（vitest / vite / esbuild 链）：全部不进产物，因此不设门禁；但 CI 在不可信 PR 上运行 vitest 时仍有路径穿越类风险面。清单与理由见 `docs/prepublish-checklist.md` §2。
- **页面操作需要侧边栏开着才能确认**：面板关闭时危险动作会被直接拒绝（不会执行）。这是有意的失败方向，但也意味着「面板不在 → 批量导出跑不完」。
- **域名白名单目前是常量**（只含 `chat.deepseek.com`）：放宽它是产品决策，不是代码改动；清单里没有的站点一律拒绝。
- 原始帧可能包含对话内容；导出前由用户自行检查，`docs/captures/` 默认 gitignore。
- 网页端 ToS 风险不在技术控制范围内。
