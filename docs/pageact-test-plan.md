# PageAct 手动测试计划

> **目标**：验证一条规则——**危险操作会先问你；你允许，它才执行；你不允许，它一步都不动。**
> 全程约 10 分钟。手测为主，因为「危险操作不确认不执行」最终要由人眼确认。
>
> 本计划针对 `v0.1.0` 的 PageAct 第二片（DSL + 执行器 + 接线 + 确认 UI）。
> 自动化测试已覆盖纯逻辑（56 条），但**确认卡片与人眼决策这一段没有自动化**，所以要手测。

---

## 0. 前置（一次性，约 3 分钟）

### 0.1 构建 dev 版（不是 prod！）

```powershell
cd E:\project\Web-OS-Agent
npm run build
```

> ⚠️ **必须用 `npm run build`，不要用 `npm run build:prod`**。
> prod 用的是 `manifest.json`（只匹配 `https://chat.deepseek.com/*`），
> dev 用的是 `manifest.dev.json`（额外匹配 `http://localhost:4318/*`）。
> 你要测本地页面，就得加载 dev 版。

### 0.2 加载扩展

1. 打开 `chrome://extensions`
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」，选 `E:\project\Web-OS-Agent\dist`
4. 记下扩展 ID（后面要看它是否正常注入）

> 如果之前已经加载过：**点一下卡片上的刷新图标**（↻），否则 manifest 变更不会生效。

### 0.3 打开侧边栏

- 点扩展图标 → 「打开侧边栏」
- 侧边栏底部有 **「页面动作 · PageAct」** 卡片（本次新增的）
- 如果没有这一块 → 扩展没更新成功，回 0.2 刷新

---

## 1. 准备一个被测页面（二选一）

### 方案 A：仓库自带的 PageAct 测试台（**推荐**）

元素固定、每种危险判定都有对应元素、点击会写日志便于确认「真的执行了」。

```powershell
npm run demo
```

打开 <http://localhost:4318/pageact>

页面里有：

| 元素 | 选择器 | 危险判定 | 预期 |
|---|---|---|---|
| 普通按钮 | `#harmless` | 无 | 直接执行，不弹确认 |
| 正文段落 | `#paragraph` | 无 | extract/text 可读 |
| 订单表格 | `#orders` | 无 | extract/table 可读（3 行 × 3 列） |
| 下载链接 | `#download-link` | `download`（有 `download` 属性） | **弹确认** |
| 下载按钮 | `#download-btn` | `download`（文本命中「下载」） | **弹确认** |
| 提交订单 | `#submit-btn` | `submit`（`type=submit`） | **弹确认** |
| 密码框 | `#pwd` | `credential`（`type=password`） | **弹确认** |
| 删除订单 | `#delete-btn` | `destructive`（文本命中「删除」） | **弹确认** |
| 下一页 | `#page-2` | 无 | 直接执行 |
| 延迟元素 | `#slow` | 无 | 2 秒后出现，供 waitFor 用 |
| 执行日志 | `#log` | — | 记录每次真实点击，用来证明动作执行了 |

### 方案 B：你本地部署的 DS

需要把它的 origin 加到**两处**（各一行）：

**① `apps/extension/manifest.dev.json`** —— 三处 `matches` 数组都要加上你的 origin：

```jsonc
"matches": [
  "https://chat.deepseek.com/*",
  "http://localhost:4318/*",
  "http://127.0.0.1:4318/*",
  "http://127.0.0.1:你的端口/*"   // ← 加你的
]
```

**② `apps/extension/src/pageact-host.ts`** —— `PAGE_ACT_ALLOWED_HOSTS`：

```ts
export const PAGE_ACT_ALLOWED_HOSTS: readonly string[] = __DEV__
  ? ["chat.deepseek.com", "localhost", "127.0.0.1", "你的主机名"]
  : ["chat.deepseek.com"];
```

> 改完必须 `npm run build` 并**刷新扩展**。
> `localhost` / `127.0.0.1` 在 dev 构建里**已经允许**了（我刚加的），
> 所以你的 DS 只要跑在本机回环地址上，这两处都不用改。

> **注意**：本地 DS 的 UI 结构未知，你需要自己在页面上找一个「危险元素」。
> 找法：在 DS 页面上找一个能下载/提交/删除的按钮，用它的选择器填进用例即可。
> 找不到就用方案 A 的测试台先验机制，再回本地 DS 试真实场景。

---

## 2. 操作位置

侧边栏 → 滚到最下面 → **「页面动作 · PageAct」** 卡片：

```
┌─────────────────────────────────────────┐
│ 页面动作 · PageAct                       │
│ 只读抓取与点击；危险操作会先问你            │
│ [ 文本框：粘 JSON            ]           │
│ [执行]                                    │
│ (结果 JSON)                               │
│ ┌─────────────────────────────────────┐ │
│ │ 需要你确认                            │ │  ← 危险动作时才出现
│ │ 点击 #download-btn                    │ │
│ │ 会触发文件下载                         │ │
│ │ 目标：button#download-btn             │ │
│ │ [允许] [拒绝]                         │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

---

## 3. 用例

> 每个用例：把 JSON 粘进文本框 → 点「执行」→ 看**结果区**和**页面上的日志**。
> 「页面日志」指测试台最下面的 `#log` 区域（方案 B 下换成你自己的观察点）。

### T1 无害点击 —— 不该弹确认

```json
[{"kind": "click", "selector": "#harmless"}]
```

- 结果区：`{"ok": true, "action": {...}, "message": "点击 #harmless → 已执行"}`
- 页面日志出现：`· 点击了无害按钮 #harmless`
- **确认卡片不出现**

### T2 读文本

```json
[{"kind": "extract", "selector": "#paragraph", "as": "text"}]
```

- 结果区含 `"data": {"kind": "text", "text": "这是一段可以被 extract/text 读走的正文。"}`

### T3 读表格

```json
[{"kind": "extract", "selector": "#orders", "as": "table"}]
```

- 结果区含 `"data": {"kind": "table", "header": ["订单号","金额","状态"], "rows": [["A-1001","12.00","已付款"], ...]}`
- 消息：`已读取 #orders（3 行 × 3 列）`

### T4 危险：下载 —— 必须弹确认

```json
[{"kind": "click", "selector": "#download-link"}]
```

- **确认卡片出现**：`需要你确认` / `点击 #download-link` / `会触发文件下载` / `目标：a#download-link`
- 此时页面日志**没有**新行（动作还没执行）
- 点「拒绝」→ 结果区：`"ok": false, "refused": true, "message": "已拒绝：点击 #download-link（会触发文件下载）"`
- 页面日志**仍然没有**新行 ✅

### T5 危险：提交表单 —— 必须弹确认

```json
[{"kind": "click", "selector": "#submit-btn"}]
```

- 确认卡片：`会提交表单`，目标 `button#submit-btn`
- 点「拒绝」→ 表单**没有**被提交（日志无 `表单被提交了`）

### T6 凭据字段 —— 必须弹确认

```json
[{"kind": "fill", "selector": "#pwd", "value": "hunter2"}]
```

- 确认卡片：`会写入密码或卡片信息`
- 点「拒绝」→ 密码框**仍然是空的**（这是最能证明「没执行」的一条：肉眼可见）

### T7 危险：删除 —— 必须弹确认

```json
[{"kind": "click", "selector": "#delete-btn"}]
```

- 确认卡片：`会删除或覆盖内容`
- 点「拒绝」→ 日志无 `删除按钮被直接点击了`

### T8 允许之后，动作**真的**执行了 ← 最重要的一条

```json
[{"kind": "click", "selector": "#delete-btn"}]
```

- 确认卡片出现 → 点「**允许**」
- 结果区：`"ok": true, "message": "点击 #delete-btn → 已执行"`
- 页面日志出现：`· （不该发生）删除按钮被直接点击了`
  （这句文案是测试台故意写的「不该发生」——**它出现就说明动作真的执行了**）

### T9 拒绝之后，动作**一步都没动**

同上 T8 的输入，点「拒绝」：

- 页面日志**没有**任何新行
- 输入框 `#who` 之类的东西没被改动

### T10 等待延迟元素

```json
[{"kind": "waitFor", "selector": "#slow", "timeoutMs": 5000}]
```

> `#slow` 页面加载 2 秒后才出现。**故意在页面刚打开 2 秒内执行**，才测得到等待逻辑。

- 结果区：`"message": "等待 #slow 出现（5000ms） → 已出现"`
- 若等不到（已超时）：`"message": "等待超时：#slow"`

### T11 填普通输入框（不该弹确认）

```json
[{"kind": "fill", "selector": "#who", "value": "张三"}]
```

- 直接执行，**不弹确认**
- `#who` 里的值变成「张三」（肉眼可见）

### T12 翻页

```json
[{"kind": "click", "selector": "#page-2"}]
```

- 直接执行，日志出现 `· 翻到了第 2 页`

### T13 非法动作被拒（模型夹带私货）

```json
[{"kind": "click", "selector": "#harmless", "js": "alert(1)"}]
```

- 结果区：`"ok": false`，`error` 含 `unexpected field "js" for click`
- 页面**没有任何**变化

### T14 非法动作种类被拒

```json
[{"kind": "eval", "code": "alert(1)"}]
```

- `error` 含 `unknown action kind`

### T15 越权站点被拒（白名单）

在**任意**非白名单页面（比如 example.com）打开侧边栏，执行：

```json
[{"kind": "click", "selector": "body"}]
```

- 结果区：`"ok": false`，`error` 含 `不在允许操控的域名白名单内`
- 或者：页面根本没有 content script → `无法与页面通信`

### T16 批量上限（20 个动作）

```json
[{"kind": "click", "selector": "#harmless"}, ... 重复 21 次 ...]
```

- 第 21 个动作被拒：`"message": "批次超过上限（20 个动作），已停止"`, `"refused": true`
- 前 20 个正常执行

### T17 翻页上限（10 次）

```json
[{"kind": "nextPage", "selector": "#page-2"}, ... 重复 11 次 ...]
```

- 第 11 个被拒：`"message": "翻页次数超过上限（10），已停止"`, `"refused": true`

### T18 批次遇错即停

```json
[{"kind": "click", "selector": "#not-exist"}, {"kind": "click", "selector": "#harmless"}]
```

- 结果区只有**一条**结果：`找不到元素：#not-exist`
- 第二个动作**没有**执行（日志无新行）——「页面状态出乎意料时不要继续点」

---

## 4. 截图清单（交付证据）

建议存到 `docs/captures/`（该目录已 gitignore PNG 之外的内容，按需提交）：

| 编号 | 截图内容 | 对应用例 |
|---|---|---|
| S1 | 侧边栏「页面动作 · PageAct」卡片整体 | 准备阶段 |
| S2 | 确认卡片出现（红色边框，含摘要与风险说明） | T4/T5/T6/T7 |
| S3 | 点「拒绝」后的结果区（`refused: true`） | T4 |
| S4 | 点「允许」后的结果区（`ok: true`）+ 页面日志新增行 | T8 |
| S5 | 密码框仍为空（拒绝后没写入） | T6 |
| S6 | 表格 extract 的结果 | T3 |

---

## 5. 出问题怎么查

| 现象 | 大概率原因 | 怎么确认 |
|---|---|---|
| 侧边栏没有「页面动作」卡片 | 加载了 prod 版，或扩展没刷新 | `dist/manifest.json` 里 `"name"` 是不是带 `(dev)` |
| 结果区报 `无法与页面通信` | content script 没注入该页面 | `chrome://extensions` → 扩展详情 → 检查「网站访问权限」；确认域名在 `manifest.dev.json` 的 `matches` 里；**改完 manifest 必须刷新扩展并重开页面** |
| 结果区报 `不在允许操控的域名白名单内` | host 不在 `PAGE_ACT_ALLOWED_HOSTS` | 本机回环地址在 dev 构建里已允许；其他域名要加进那个数组 |
| 危险动作**不弹**确认直接执行了 | ⚠️ 严重问题 | 检查该元素的 `type` / `download` 属性 / 文本；文本启发式只匹配 **≤16 字**且含「下载/提交/支付/下单/付款/删除/清空/销毁」的短文本 |
| 危险动作**永远**在弹确认 | 启发式太敏感 | 看确认卡里的「目标：」是什么元素 |
| 确认卡片不出现 | 侧边栏没开 | 确认卡片靠侧边栏的 UI port 推送；**面板关着 = 没人能回答 = 直接拒绝**（这是有意的失败方向） |
| 点「允许」后动作没执行 | 元素已经不在页面上了（选择器过期） | 重新执行一次 |

---

## 6. 收尾

```powershell
# 停掉本地 demo
# （前台运行的话 Ctrl+C；后台的话按端口杀）
```

```powershell
# 确认你的原浏览器还在（这个计划不该影响它）
Get-Process chrome -EA 0 | Measure-Object | Select-Object -ExpandProperty Count
```

---

## 附：动作 DSL 速查

| kind | 字段 | 危险？ |
|---|---|---|
| `click` | `selector` | 目标危险时危险（下载/提交/删除） |
| `fill` | `selector`, `value` | 目标是凭据字段时危险（≤1000 字符） |
| `scroll` | `to`: `"top"` / `"bottom"` / `{"selector": "..."}` | 否 |
| `extract` | `selector`, `as`: `"text"` / `"table"` | 否 |
| `waitFor` | `selector`, `timeoutMs`（100–30000） | 否 |
| `nextPage` | `selector` | 目标危险时危险 |

硬上限：选择器 ≤200 字符、值 ≤1000 字符、批次 ≤20 个动作、翻页 ≤10 次、超时 100–30000ms。
**多一个字段就整条拒绝**（模型夹带的任何东西都进不来）。

---

## 7. 2026-10-23 实测结果补充（本轮已跑掉的部分）

| 项 | 结果 | 说明 |
|---|---|---|
| 记忆总结真闭环 | **PASS** | `npm run probe:memory`：WS 握手 + 令牌 → `memory-summary`（真实 Ollama qwen2.5:3b，冷 6.6s / 热 1.2s）→ `memory-store save` → SQLite → `get` 读回。探针：`scripts/probe-memory-summary.mts` |
| 提示词分类改进 | **已修并复验** | 「下周要交答辩录屏」曾被归入 decisions；收紧 decisions 定义 + 补充截止日期示例后，实测决策/待办分类正确 |
| 画布红点（关自动渲染） | **状态机已覆盖，DOM 接线未自动化** | `canvas-controller.test.ts` 7 个场景覆盖 OFF→pending→红点→激活清零；DOM 接线只有 sidepanel.ts 两行（`toggleAttribute`），无 jsdom 不值得为它建测试钩子 |
| `[hidden]` 失效 bug | **已修** | `.pageact-confirm` 的 `display: flex` 压过 UA 的 `[hidden]` 样式 → 确认卡片永远显示空红框。已加全局守卫 `[hidden] { display: none !important }` |
| 可渲染项代码墙 | **已优化** | 列表里 render 类 artifact 只显示前 400 字符预览 + 总字符数提示，全量代码在画布看 |
| 真实 DeepSeek 闭环（G1–G4） | **待手动** | 需要登录态，无法诚实自动化。按本计划 §1–§4 在真实页面上跑 |

> 环境注意：Chrome 156 已禁 `--load-extension`（日志明说 `--disable-extensions-except is not allowed`）；自动化截图/加载扩展用 **Edge**。

---

## 8. 模型触发动作（```pageact fence，2026-10-23 新增）

手动 JSON 是调试口；模型触发才是产品。触发语法与 artifact 同一条 fence 管道：

````text
```pageact
[{"kind":"extract","selector":"table","as":"table"}]
```
````

手测步骤（真实 DeepSeek 页）：
1. 让模型「用 ```pageact 代码块输出一个只读抓取动作」；
2. 观察：turn 结束后动作**自动执行**，侧边栏控制台显示「模型动作已执行」+ 结果；
3. 换个危险动作（点击提交/下载类元素）→ 侧边栏**弹确认卡片**，与手动路径完全一致；
4. 安全动作（extract/scroll/waitFor）不弹确认直接跑——符合「危险才问，安全放行」。

> 关键点：模型触发**只省了「你贴 JSON」这一步**，域名白名单 / 校验 / 危险确认一道闸都不绕过。

---

## 9. 批量导出 CSV（2026-10-23 新增 `export` 动作）

pipeline 收尾动作：`{"kind":"export","format":"csv"}`，把本批次已抽到的数据组装成 CSV 并下载。

手测（本地 demo 页有表格）：
1. 让模型输出 ````pageact` 批次：`extract(table) → nextPage → extract(table) → export(csv)`；
2. 到 `export` 时会**弹确认**（下载危险）；
3. 允许后浏览器下载 `pageact-export-<时间戳>.csv`，内容是两页表头+行的拼接。

> 只接受 `format: "csv"`。xlsx 需要 SheetJS（新增依赖，走白名单 PR），不是静默支持。
