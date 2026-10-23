# V2 架构规划：本地优先的浏览器 Agent 运行时

> 状态：规划稿 v1（2026-10-23） · 作者：haoyuan + Momo  
> 基线：现有 v0.1.0，10,111 行 TS（含测试），248 条测试 + 6 条真实模型 E2E

## 0. 口径与定位

**行数口径（先纠偏）**：现有代码已 10,111 行，"目标 5000 行"不成立。本文按以下口径规划：

| 口径      | 行数        | 说明                                                        |
| ------- | --------- | --------------------------------------------------------- |
| 现有基线    | 10,111    | Sensor / Router / Actor / UI / Artifacts / memory.json 记忆 |
| V2 净增   | ~5,000    | 本文五大能力                                                    |
| V2 落地总量 | ~15,000   | 基线 + 净增                                                   |
| 远期扩展    | → 18,000+ | 语义检索、多 adapter、可选 CDP 层（**不在本规划内**）                       |

**定位**：本地优先的开源 Agent 运行时；单人维护、可独立运营的开源项目。

**一句话架构**：在现有四层（Sensor → Router → Actor → UI）之上新增两个层——**Brain（浏览器内 WebGPU 推理）**&#x4E0E; **PageAct（页面 DOM 操控）**，记忆系统从 JSON 文件升级为 SQLite，Artifacts 沙箱升级为 React 可交互 + 结果回传。

## 1. 五大能力与现状映射

| # | 能力                    | 现状                                                                             | V2 动作                                                                         |
| - | --------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 1 | ~~零延迟~~ → **零安装**本地推理 | Ollama 3B @ 127.0.0.1:11434（已交付，`packages/actor/src/memory/summarize.ts`）      | **新增** Brain 层：Transformers.js v4 + WebGPU，Ollama 并存不替换。**卖点已按实测修正，见 §2.1.1** |
| 2 | 真·网页操控                | 无（roadmap P5 待做，只有本地命令白名单）                                                     | **新增** PageAct 层：content script DOM 操控 DSL；**砍 CDP 无头浏览器**                    |
| 3 | Artifacts UI          | HTML/SVG 沙箱已交付（MV3 sandbox page + opaque iframe + CSP 契约测试）                    | **升级**：React/JSX 实时渲染 + `webos.report()` 交互回传                                 |
| 4 | 持久记忆                  | `memory.json` 原子写，上限 100 条 / 1 MiB（`packages/actor/src/memory/store.ts:25-26`） | **升级**：`node:sqlite` 三表 schema + 迁移工具 + 检索接口                                  |
| 5 | 安全与纯净                 | token 握手、命令白名单、沙箱 CSP、opaque origin（已交付）                                       | **加固**：依赖审计 CI、速率限制、危险操作二次确认、可验证安全承诺清单                                        |

## 2. 关键技术选型

### 2.1 Brain —— WebGPU 本地推理

**选型：Transformers.js v4（@huggingface/transformers），模型 Qwen2.5-1.5B-Instruct ONNX q4（备选 Llama-3.2-1B / Gemma 4 E2B）。**

| 候选                  | 结论   | 理由                                                                                 |
| ------------------- | ---- | ---------------------------------------------------------------------------------- |
| Transformers.js v4  | ✅ 首选 | HF 2026-04 发布官方 MV3 集成指南；C++ 重写 WebGPU 运行时；tokenizer 独立包 8.3KB 零依赖；模型缓存进 IndexedDB |
| WebLLM              | 备选   | chat 型任务强，但降噪/摘要是任务管道，WebLLM 优势用不上；运行时体积更大                                         |
| ONNX Runtime Web 裸用 | 否    | 可控但重复造轮子，开发效率低                                                                     |

**模型选择理由**：DeepSeek 页面中文为主 → Qwen 系中文摘要质量优于同档 Llama/Gemma；1.5B q4 ≈ 1GB 下载 + 4-bit 量化压低核显 VRAM 占用。

### 2.1.1 实测结论（2026-10-23）：1.5B 不达标，卖点必须重写

门禁脚本：`scripts/brain-ab/`（记忆摘要 + 降噪两个 gate）。方法：Ollama 上跑 `qwen2.5:3b` vs `qwen2.5:1.5b`（同系列、同 Q4 量化，隔离"参数规模"这一个变量），**每模型 3 轮取平均**，复用生产 prompt 与生产后处理（`@webos/actor` 的 `buildPrompt` / `parseModelJson`）。

**为什么要用 3 轮**：生产温度 0.2 下，单次跑出的结论在连续两次之间能差 24 个百分点（候选召回 59% → 35%）。一次性判定是噪声，不可作为决策依据。

**记忆摘要（10 条样本 × 3 轮）**

| 指标             | 3B      | 1.5B    | 判定                  |
| -------------- | ------- | ------- | ------------------- |
| 事实召回率          | 57%     | 54%     | 持平（95% of baseline） |
| open_loops 归因率 | 25%     | 26%     | 持平                  |
| facts 超 40 字比例 | 4%      | **43%** | 差 10 倍              |
| 边界违规率          | 2%      | 6%      | 绝对值可接受              |
| 中位延迟           | 1279 ms | 876 ms  | 仅快 1.46x            |

**记忆摘要 · 收紧长度守卫后复测**（超 40 字的条目直接丢弃，而非截断成碎片）

| 指标             | 3B            | 1.5B          | 变化      |
| -------------- | ------------- | ------------- | ------- |
| 事实召回率          | 57% → **52%** | 54% → **24%** | 1.5B 腰斩 |
| open_loops 归因率 | 25% → 19%     | 26% → **11%** | 1.5B 腰斩 |
| facts 超字数率     | 4% → 0%       | 43% → 0%      | 守卫生效    |

**降噪（4 条样本 × 3 轮）**

| 指标             | 3B      | 1.5B     | 判定            |
| -------------- | ------- | -------- | ------------- |
| 正文保留率          | 97%     | 100%     | 假象——它连噪声一起保留了 |
| 噪声剔除率          | 52%     | **16%**  | **FAIL**      |
| 压缩比（body / 输入） | 0.71    | **0.93** | **FAIL，等于复制** |
| 中位延迟           | 3107 ms | 3105 ms  | **零收益**       |

**三条结论**

1. **"零延迟"这个卖点是错的**。Ollama 本来就跑在本地，WebGPU 换不来数量级差异：记忆摘要只快 1.46x，降噪场景**延迟完全相同**（长输入短输出，瓶颈在 prefill 而非生成）。
2. **1.5B 不能承担降噪**：压缩比 0.93 说明它没在做提取，只是在搬运输入。这类输出一旦进上下文，等于没降噪还多花一遍 prefill。
3. **"质量接近 3B"是假象，加完守卫就现原形**。收紧长度守卫后，1.5B 召回率从 54% 腰斩到 24%，端到端可用质量只剩 3B 的 **46%**。

   这是小模型在 Agent 系统里的典型陷阱：**它不"答错"，它是"格式不合规 → 被确定性守卫丢弃 → 信息静默消失"**。只评估模型输出质量会严重高估它，必须评估端到端。1.5B 那 43% 的超长条目里装的是真实信息，守卫把信息连同违规格式一起扔了。
4. 另有约 1/30 概率把整段对话原样写进 facts——隐私红线级别的偶发风险，长度守卫已缓解但未根除。

**因此 P7 要改的是规格，不是文案：**

- **1.5B 出局**。两个任务都不达标，且不是"差一点"：降噪等于复制（压缩比 0.93），记忆摘要端到端只有 3B 的 46%。**继续在 1.5B 上优化 prompt 是浪费时间**——差距的根源是指令遵守能力，那是模型规模决定的，prompt 工程救不回来。
- **WebGPU 通道的真实价值 = 零安装**。不用装 Ollama、不用管常驻进程，模型随扩展生命周期管理。~~零延迟~~ 不成立（Ollama 同为本机，延迟相当）。零 Token、零数据外传本来就成立，不是 WebGPU 独有的。
- **模型规格上调到 3B 级**，两个候选：
  | 候选                          | 体积      | 中文 | 取舍                           |
  | --------------------------- | ------- | -- | ---------------------------- |
  | Qwen2.5-3B-Instruct ONNX q4 | ~2 GB   | 强  | 质量直接对齐现有 Ollama 基线，代价是下载体积翻倍 |
  | Gemma 4 E2B（HF 官方 MV3 示例）   | ~500 MB | 弱  | 体积小、有官方参考实现，但中文摘要弱于同档 Qwen   |
  推荐 **Qwen2.5-3B**：中文是主战场，且能与 Ollama 基线逐项对齐比较。
- **降噪任务无论最终用哪个规格，都先走 Ollama 通道**。降噪是长输入场景，浏览器端 prefill 成本最高、延迟收益为零（实测 3107ms vs 3105ms）。

**方法学 caveat**：浏览器端实际跑的是 ONNX q4，本测试用 Ollama 的 GGUF Q4_K_M。量化格式差异存在，但不足以改变"16% vs 52%"这个量级的结论。浏览器端落地后必须用同一套 fixtures 复测一次。

**MV3 硬约束（来自官方指南与社区踩坑记录）**：

- Service Worker 无 WebGPU / DOM → 模型必须跑在 **Offscreen Document**（`chrome.offscreen.createDocument`，reasons 需合法声明）里的 **Dedicated Worker**，双进程隔离防 UI 冻结；
- MV3 CSP 静默阻断远程动态代码 → ONNX/WASM 资源全部**打包进扩展产物**，模型权重首次使用时从 HF 下载并缓存 IndexedDB（fetch 二进制不受 script CSP 限制，但需 host_permissions）；
- WebGPU 探测失败（无 GPU / 核显驱动问题）→ **WASM 回退**，慢 5-10x 但保证功能可用；
- 双通道策略：**默认 Ollama 3B（质量优先）→ 未安装 Ollama 时自动降级 WebGPU 3B（自包含优先）**，sidepanel 显示当前通道。**降级通道同样是 3B 级**——§2.1.1 的实测结论是 1.5B 在两个任务上都不达标，拿它当降级方案等于「一降级就失效」。

### 2.2 PageAct —— 真·网页操控

**决策：只做当前标签页 DOM 操控（content script），砍掉 CDP 无头浏览器。**

砍 CDP 的三条理由：

1. 越过项目非目标红线（`docs/roadmap.md` 非目标：不做账号系统、不追求绕过站点检测）；
2. `chrome.debugger` 触发"正在被调试"横幅，用户体验差 + Web Store 审核高风险档；
3. CDP 是行数无底洞，会吃掉 V2 预算的一半，而目标用例（批量导出订单/会话）在用户**已登录的当前页**内即可完成。

**Action DSL（声明式，禁止模型输出任意 JS）**：

```ts
type PageAction =
  | { kind: "click"; selector: string }
  | { kind: "fill"; selector: string; value: string }
  | { kind: "scroll"; to: "top" | "bottom" | { selector: string } }
  | { kind: "extract"; selector: string; as: "text" | "table" }
  | { kind: "waitFor"; selector: string; timeoutMs: number }
  | { kind: "nextPage"; selector: string };   // 翻页
```

- 每个 action 有 JSON Schema 校验 + 域名白名单 + **危险操作二次确认 UI**（下载、表单提交、批量循环超过 N 次）；
- 执行器跑在 ISOLATED world 的第三个 content script，经 `chrome.runtime` 与 SW 通信；
- 已知技术坑：React/Vue 受控组件的 `input` 填值需 native setter hack（`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set` + 手动 dispatch `input` 事件）；`el.click()` 合成事件对绝大多数 SPA 有效，个别站点需 fallback 到 `dispatchEvent(new MouseEvent(...))`；
- 批量导出用例：extract 循环 + 翻页 → 数据组装 → CSV 落盘（已落地，见 §2.2.4）；xlsx 需 SheetJS CE（Apache-2.0），走白名单决策。

### 2.2.1 已落地（2026-10-23）：DSL 校验 + 执行器核心，纯逻辑 100% 可测

P8 的第一步：把「模型能说什么」和「页面会被做什么」钉死，做成可单测的纯核心。**content script 接线与确认 UI 留到下一片**——先有契约，再有管道。

**新包 `@webos/page-act`**（`packages/page-act/`）：

- `src/dsl.ts` —— Action DSL 与**唯一校验闸门**。核心约束是**模型永远不产出 JavaScript**：只有六种声明式动作，没有 `eval`、没有 script 类型、没有自由代码字段。校验是**严格字段集**（多一个字段就拒）、有长度上限（选择器 200 字符 / 值 1000 字符）、有范围上限（`waitFor` 100–30000ms）。选择器额外拒绝 `<` `{` `}`（合法 CSS 里不会出现），`>` 保留（子代组合器合法）。
- `src/executor.ts` —— 执行器**不碰 `document`**：页面能力全部经 `PageEnvironment` 注入。因此整层能在 node 里单测（本仓库没有 jsdom，为六个 DOM 调用引入一个不划算），真实 DOM 适配器也保持薄且显眼。
- `src/dom-environment.ts` —— 唯一碰 DOM 的文件：native setter hack（React 受控组件）、`MouseEvent` fallback、表格行提取、**危险元素启发式判定**（`download` 属性 / `type=password` / `type=submit` / 短文本关键词）。

**「危险操作不确认不执行」（红线 2）落在执行器里，不靠调用方自觉**：

- 页面元素带 `danger` 提示（download / submit / credential / destructive），由 DOM 适配器判定；
- 命中危险 → 必须经 `confirm` 回调批准；**没有 `confirm` 回调 = 拒绝**（默认拒绝，不是默认放行）；
- 危险动作被拒 → 整个批次停止；
- 批次另有两道闸：动作总数上限（默认 20）、翻页步数上限（默认 10，防失控翻页循环）；
- 页面抛异常（非法选择器等）被捕获成失败结果，不会掀桌子。

**验证**：`packages/page-act/test/` 35 条测试——DSL 拒绝每一个多余字段 / 越界值 / 伪装成动作的任意 JS；执行器在假环境下验证六种动作、危险动作的三种确认结果（无回调 / 拒绝 / 批准）、批次三道闸。**这一层没有 DOM，所以 100% 覆盖**。

**尚未覆盖**：`dom-environment.ts` 不写 jsdom 单测（仓库没有 jsdom，为六个 DOM 调用引入一个不划算），但**已用真实 Chromium 引擎验证**——`scripts/verify-pageact-dom.ts`（`npm run verify:pageact-dom`）把 `@webos/page-act` 打成 IIFE、在含危险元素的 fixture 页里驱动，**11/11 通过**：危险分类（下载/凭据/提交/删除/无害）、native setter 填值（value + input 事件）、表格抽取、合成点击、危险点击无确认即拒绝。

**还没做的（本片的当时状态；后续 §2.2.2–2.2.4 已逐项补齐）**：content script 接线、SW 侧宿主 `pageact-host.ts`、域名白名单、确认 UI、批量导出（CSV）。

### 2.2.2 已落地（2026-10-23 晚）：接线 + 确认 UI —— 危险操作**能**执行，但必须用户同意

用户的要求原话：「危险操作可以执行，但需要用户同意」。这句话定死了整个交互：**默认拒绝只是兜底**，常态是**弹窗问**——不是把危险操作一刀切掉，那等于没有这个能力。

四段链路：

```
content script（唯一碰 DOM）
  │ 执行到危险动作 → 需要决定
  │ sendMessage（通道保持打开，等人回答）
  ▼
service worker（PageActHost）
  │ 域名白名单校验 → 登记待确认 → 推给面板
  ▼ UI port
side panel（确认卡片）
  │ 「允许」/「拒绝」
  ▼ sendMessage
service worker → 答复 content script → 动作继续 / 批次停止
```

- **协议**：确认请求/应答类型放 `@webos/shared`（四方共用），`ConfirmRegistry` 在 `@webos/page-act`（纯逻辑，9 条测试）。文案（`describeAction` / `describeDanger`）也搬进 shared——四方必须说同一句话，否则确认框和审计日志会各说各话。
- **SW 侧 `pageact-host.ts`**：域名白名单（默认只 `chat.deepseek.com`，与 manifest 的 `host_permissions` 一致）+ 确认登记 + 桥接 content script（12 条测试）。
- **content script `pageact-content.ts`**：manifest 里的第三个 content script（ISOLATED，`document_idle`）。执行前**再校验一次**（最后一道闸——worker 也校验过，但 worker 若被攻破，这里还能拦住）；遇到危险动作就向 SW 问，**只有明确批准才算同意**，没答复 = 拒绝。
- **side panel**：新增「页面动作」控制台（JSON 输入 + 执行按钮，这是模型学会提议动作之前的手动触发器）+ 确认卡片（动作摘要 + 风险说明 + 目标元素 + 允许/拒绝）。多个确认请求**排队**，一次只问一个。

**静默即拒绝**：没有面板连接 → 直接 `no-ui` 拒绝（不等待一个永远不会来的答案）；面板在但没人回答 → 60 秒后 `timeout` 拒绝；**晚到的答复不能复活**已经拒绝的动作。

**已知缺口**：
- 域名白名单是常量，放宽它是产品决策（也会影响 Web Store 审核），不是代码改动；
- xlsx 导出未做——需要 SheetJS，属新增依赖，走白名单 PR 决策（CSV 已落地，见 §2.2.4）。

### 2.2.3 已落地（2026-10-23）：模型触发动作（```pageact fence）

手动 JSON 是调试口，模型触发才是产品。触发语法复用了 artifact 的同一条 fence 管道——**零新正则、零新攻击面**：

```text
```pageact
[{"kind":"extract","selector":"table","as":"table"}]
```
```

- **`shared` 新增 `extractPageActions(text)`**：从答案里挑出 `language === "pageact"` 的 fence、`JSON.parse`，坏 JSON 直接跳过（模型的 JSON 不可靠，不值得一次 UI 往返）。**返回未校验值**——严格校验仍在 `@webos/page-act` 的 `validatePageActions`，与手动控制台共用同一个强制点。
- **后台 settle 时自动跑**：`maybeRunPageActions` 在 turn settle 时提取并逐块送 `pageActHost.run`，域名白名单 / 校验 / 危险确认全部共享手动路径。**危险动作照常弹确认**——「模型触发」只省了「用户自己贴 JSON」这一步，不绕过任何一道闸。按签名 dedup，settle 事件重投不会重复跑同一批。
- **侧边栏回显**：新增 `webos/ui.pageact.result` 推送，`pageActPanel.showRunResult()` 把「模型动作已执行 / 失败」写进控制台——模型是调用方时，控制台也要能看见结果。

新增 5 条 `extractPageActions` 测试（非 pageact fence 忽略、坏 JSON 跳过、未闭合 fence 跳过、语言大小写不敏感）。

### 2.2.4 已落地（2026-10-23）：批量导出（CSV 优先）

`extract 循环 + 翻页 → 数据组装 → 落盘` 的最后一块，分两步走，**CSV 已落地，xlsx 留白名单**：

- **新动作 `{ kind: "export"; format: "csv" }`**：DSL 的终结动作，模型 pipeline 的收尾。校验只接受 `csv`（xlsx 需要 SheetJS，是新增依赖，走白名单 PR 决策，不是静默接受一个字段）。`DANGER_BY_KIND.export = ["download"]`——下载必须确认。
- **`packages/page-act/src/export.ts` 新增 `buildCsv()`**：纯「数据组装」。表格优先（首表表头当 CSV 表头、追加各表行）；只有文本抽取时退化成单列 `text`；空数据返回 `rowCount 0`。含逗号/引号/换行的字段正确加引号转义。
- **执行器 `export` 处理**：不碰 DOM，把本批次已抽到的 `ExtractData` 组装成 CSV，放在结果的 `export` 字段里。**确认后**才组装；无确认渠道 = 默认拒绝；无数据 = 失败（不是拒绝）。
- **worker 落盘**：`pageact-host.ts` 检测结果里的 `export` 字段，`chrome.downloads.download(dataURL)` 落 CSV。content script 在 ISOLATED world 里没有 `chrome.downloads`，所以下载必须回到 worker。manifest 加 `downloads` 权限。

新增 11 条测试：4 条 `buildCsv`（表头/转义/单列/空）+ 4 条执行器 export（组装/无确认拒绝/无数据失败/纯文本单列）+ 3 条 DSL（拒 xlsx、拒多余字段、download 危险）。



### 2.3 Artifacts —— React 渲染 + 交互回传

现状沙箱（opaque-origin iframe + `default-src 'none'`）保持不变，升级三点：

1. **JSX 实时渲染**：模型输出 ` ```jsx ` 代码块 → sandbox page 内 **Sucrase**（~200KB，比 @babel/standalone 小一个数量级）转译 JSX → 本地打包的 React/ReactDOM IIFE 执行。**为什么不走 esm.sh CDN**：沙箱 CSP `connect-src 'none'` 下任何网络加载都不可能，必须全部本地打包。
2. **交互回传协议**：沙箱注入 harness 脚本暴露 `webos.report(payload)` → iframe `postMessage` → sandbox page → sidepanel → background → 写入下一轮 `SystemContext`（复用现有注入通道）。同时在 persona 注入里告知模型该 API 存在，模型才能生成"会汇报的"组件。
3. **Sidepanel 画布 + 自动渲染**：侧边栏内「控制台 / 画布」双视图，回答结束后由 SW 精确推送一次最新 artifact，画布自动渲染；单 iframe 全程复用，signature 幂等；可一键关闭自动（状态持久化）。

安全注意：模型生成的 React 代码仍是**不可信输入**，沙箱红线不变（无 `allow-same-origin`、无网络、无扩展存储访问）；回传 payload 限长（≤ 4KB）并做 schema 校验。**自动渲染不改变安全边界**：边界是沙箱隔离，不是"用户点过一下"——点击门槛是体验设计，已在 threat-model 中显式记录该判定。

### 2.3.1 实测结论（2026-10-23）：技术路径成立，两个规划假设被推翻

**两个规划里的错误假设，实测后修正：**

| 原假设                            | 实测                                                                          | 影响                                          |
| ------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------- |
| React 用 UMD 文件 vendored        | **React 19.3.1 已移除 UMD 构建**，只能自己 bundle 成 IIFE                              | 新增构建步骤 `scripts/build-artifact-runtime.mjs` |
| Sucrase ~200KB                 | **201.2kb**（猜对了）                                                            | 无影响                                         |
| 沙箱内 `<script src>` 加载本地 bundle | **opaque-origin iframe 的 CSP `'self'` 不匹配扩展源**，`chrome-extension://` 资源加载不到 | runtime 必须**内联**进 srcdoc                    |

**体积实测**：`artifact-runtime.js`（React 19 + ReactDOM）215.9kb、`artifact-sucrase.js` 201.2kb（两者生成到 `.tmp-runtime/`，**不进扩展包**——只有 E2E 脚本读它们当源文本），JSX artifact 的 srcdoc **420kb**。`sidepanel.js` 曾因此从 168.8kb 涨到 **1.2mb**（静态内联 runtime 源），已用「动态 import + esbuild 代码分割」修复，见下方「体积优化已落地」。

**端到端验证（第一轮，React 场景）**：`scripts/verify-artifact-runtime.ts`，headless Chrome，`npm run build` 后运行，4/4 通过。**第二轮（2026-10-23，新增 Canvas 动画场景）扩到 8/8**，见下方「画布与自动渲染已落地」。

**一个刻意的安全取舍**：转译后的代码用 `document.createElement("script")` + `textContent` 挂载执行，而不是 `new Function`。后者要求 CSP 开 `unsafe-eval`，前者只需要本来就开着的 `unsafe-inline`——**不给沙箱增加新的权限**。

**回传链路已接通**（`webos.report` → `SystemContext`），四跳且每跳都有校验：

```
artifact iframe (opaque origin)
  │ postMessage，只能用 "*"（opaque origin 无地址）
  ▼
sandbox page  ← 校验 event.source === target.contentWindow
  │ （MV3 sandbox 页无 chrome.* API，必须借道）
  ▼
sidepanel     ← 校验 event.source === iframe.contentWindow（在 sandbox-frame.ts 工厂内）
  │ chrome.runtime.sendMessage
  ▼
background    ← normalizeArtifactFeedback()：拒绝畸形输入、payload 截断到 4KB
  │ 存 TabState.artifactFeedback（上限 8 条）
  ▼
SystemContext.artifactFeedback → 与 memory/persona 合并后注入下一轮
```

三个刻意的安全选择：

1. **合并顺序最后**：`memory → persona → artifactFeedback`。回传描述的是"用户刚刚做了什么"，是最新的信号，应该离用户下一句话最近。
2. **session 作用域**：`artifactFeedback` 不写进持久化快照，恢复时恒为空数组——避免上一次会话的交互泄漏到下一次。
3. **身份校验只能用 `event.source`**：外层沙箱 iframe 是 opaque origin，`event.origin` 恒为 `"null"`，**任何 origin 比较都会静默丢掉全部回传**（这个 bug 真实存在过一整轮，见下方修正记录）。因此监听必须下沉到持有 iframe 引用的组件内部（`packages/ui/src/sandbox-frame.ts`），比较 `event.source === iframe.contentWindow`；`sidepanel-shell.test.ts` 有回归护栏：sidepanel 源码不得出现 origin 比较。

**已发现并修复的链路 bug（2026-10-23）**：回传协议四跳中，sidepanel 原本写的是 `event.origin !== self.location.origin` 校验，而沙箱 iframe 的 origin 恒为 `"null"`——**第一跳就把所有消息丢光了**，协议层/存储层/注入层全对但链路实际不通。修复：改用 `event.source` 校验（工厂闭包持有 `contentWindow`），补 7 条单测覆盖 source 不匹配 / trusted 为 null / type 不符 / payload 非法。**教训：单测全绿 ≠ 链路打通，跨进程契约必须有端到端验证。**

**端到端验证**（`scripts/verify-artifact-runtime.ts`，headless Chrome，`npm run build` 后运行）——**8/8 通过**：

| 检查                         | 结果            |
| -------------------------- | ------------- |
| React 挂载成功                 | ✅ 按钮渲染为「点击 0」 |
| hooks 生效（useEffect 执行）     | ✅             |
| `webos.report` harness 可调用 | ✅             |
| 错误代码展示可读提示而非空白             | ✅             |
| Canvas 2D context 可获取       | ✅             |
| Canvas 可绘制                  | ✅ fillRect 已执行 |
| requestAnimationFrame 循环推进   | ✅ frames=10  |
| toDataURL 可用                | ✅ data:image/png |

**动画验证为什么用 CDP 而不是 `--dump-dom`**：`--dump-dom` + `--virtual-time-budget` 的快照模式下，虚拟时间不产生动画帧，`requestAnimationFrame` 最多触发一次（加 `--run-all-compositor-stages-before-draw` 也是 1 帧），**无法证明循环推进**。改用 CDP（`--remote-debugging-port=0` + `DevToolsActivePort` + Node 22 全局 WebSocket，零依赖）驱动活页面，rAF 以真实帧率运行——这是唯一诚实的方式。探针为自带 4 秒看门狗的 html artifact，rAF 坏了会 FAIL 而不是挂死。

**画布与自动渲染已落地**（2026-10-23，`packages/ui/src/artifact-canvas.ts` + `canvas-controller.ts` + `packages/shared/src/artifacts/auto-render.ts`）：

- 触发：SW `ingest()` 内 `isTurnSettled()`（`sensor.stream.end` 且 reason ∈ {finished, incomplete}，排除 aborted/error）→ `selectAutoRenderArtifact()` 取最后一个可渲染项 → signature 去重后经 `webos/ui.artifacts` 端口消息**精确推送一次**。选推送而非轮询：end 事件只在 SW 里产生，轮询要让 sidepanel 猜"何时算完成"。
- 画布侧四道闸防卡顿：一轮一次 + SW 侧 signature + UI 侧 signature + 单 iframe 复用（切视图用 `hidden` 不销毁）。
- 纯逻辑状态机 `canvas-controller.ts` 的关键设计：dedupe 比较 `renderedSignature` 而非 `seenSignature`——否则"自动关 → A 到达 → 开自动 → 开画布 → 补拉 A"会把 A 误判为重复而永不渲染。
- 已知取舍：画布 iframe 绝对定位填充（flex 子 iframe 百分比高度会塌陷）；非可渲染 artifact 用 `pre.textContent` 只读展示；JSX 运行时缺失时降级代码视图。

**体积优化已落地（2026-10-23）**：sidepanel 改为启动时动态 `import("./generated/artifact-runtime.js")`，resolve 后再 `setArtifactRuntime()` 注入。缝本来就在——UI 包从不 import 构建产物，runtime 一直由扩展侧注入，改的只是**加载时机**。`scripts/build.mjs` 给 sidepanel 条目开 `splitting: true`（代码分割要求用 `outdir` 而非 `outfile`；esbuild 不允许 inline sourcemap 与 splitting 共存，dev 改用 linked map）。

结果：`sidepanel.js` **54.4kb**（原 1.2mb），runtime 独立成 **418.0kb** chunk 与面板并行下载。**manifest 一个字未改，CSP 零让步**。

**顺带修掉的重复打包**：runtime 曾在扩展包里出现两次——一次作为 sidepanel.js 里的内联字符串，一次作为 `dist/artifact-runtime.js` + `dist/artifact-sucrase.js` 两个独立 IIFE（427kb），而**扩展根本不加载它们**（只有 E2E 脚本读它们当源文本）。现已改为生成到 `.tmp-runtime/`（gitignore + eslint ignore），扩展包（prod）从 **1.04mb 降到 652kb**。

> 踩坑：`.tmp-runtime/` 起初没进 eslint 的 ignore 列表，lint 把 400KB 压缩 bundle 当普通 JS 解析，**1662 个错**。**凡是把构建产物挪出新目录，都必须同步加 ignore（eslint + gitignore）**，否则 CI 会红。

原计划的「让 sandbox page 读取 `artifact-runtime.js` 源文本再 postMessage 给 iframe」方案**作废**：那条路要把 sandbox CSP 的 `connect-src 'none'` 放宽到 `'self'`，而动态 import 拿到同样的收益且不碰任何 CSP——**拿一条安全边界换字节数从来不是好交易**。

残余边界：chunk 未落地时 JSX 走既有降级（只读代码 +「JSX 运行时未加载」提示）；chunk 加载失败同样降级（`.catch` 吞掉，避免 unhandled rejection）。降级是**功能缺失，不是安全漏洞**。

> watch 模式的小尾巴：runtime 内容变化会产生新 hash 的 chunk，esbuild 不清理旧文件（孤儿 chunk 留在 dist）。非 watch 构建每次从干净 dist 开始，只有长驻 dev session 才会看到堆积。

**UI 层去重（2026-10-23）**：三处重复收进共享原语——

- `packages/ui/src/dom.ts` 的 `el()`：原先在 `artifact-panel.ts` / `artifact-canvas.ts` / `debug-panel.ts` 各抄一份（实现完全相同）。它同时是「模型输出只走 `textContent`、绝不 `innerHTML`」这条红线的落点，**一份实现 = 一处要守住**。
- `packages/ui/src/render-plan-text.ts` 的 `describeRenderPlan()`：artifact 列表和画布都要说明「为什么只展示代码」，原先各写一份且**已经漂移**（列表说「只读代码，不执行」，画布说「该语言不支持渲染」）。现在一句话、一处；文案只从 plan 的 `reason` 枚举派生，模型内容永远进不了这句话。
- `packages/shared/src/types/artifacts.ts`：`reason` 从 `string` 收紧为 `ArtifactRenderReason` 联合类型（`"unsupported-language" | "too-large" | "react-runtime-missing"`）——原来的 `string` 让调用方无法穷举检查，类型注释还漏写了 `react-runtime-missing`。
- `apps/extension/src/sidepanel.ts`：列表与画布两个 mount 里完全相同的 `onLoadArtifacts` 回调收成一个 `loadArtifactsForView()`。

### 2.4 SQLite 持久记忆

**选型：Node 22 内置 `node:sqlite`（零新增依赖），放在 Actor 进程。**

| 候选             | 结论   | 理由                                                     |
| -------------- | ---- | ------------------------------------------------------ |
| `node:sqlite`  | ✅ 首选 | Node ≥22.13 免 flag 可用；零依赖直接命中"0 恶意依赖"红线；记忆本来就在 Actor 侧 |
| better-sqlite3 | 备选   | 成熟但 native 依赖 + prebuilt 二进制，审计面变大                     |
| sql.js（WASM）   | 否    | 浏览器侧方案，与"记忆归属 Actor"的现有架构冲突                            |

**Schema（三表）**：

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY, tab_id INTEGER, site TEXT,
  started_at TEXT, summary TEXT, source_json TEXT
);
CREATE TABLE facts (            -- 用户画像 / 偏好 / 项目规范
  id TEXT PRIMARY KEY, kind TEXT,
  key TEXT NOT NULL UNIQUE,     -- UNIQUE 是 upsert 的前提，漏了会报
                                -- "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint"
  value TEXT, confidence REAL, updated_at TEXT
);
CREATE TABLE episodes (         -- 情景记忆（原始摘要条目，等价现 memory.json entries）
  id TEXT PRIMARY KEY, saved_at TEXT, model TEXT,
  source_json TEXT,             -- 比原规划多一列：MemorySource 需要随条目一起存
  memory_json TEXT
);
```

- 迁移工具：`memory.json` → SQLite 一次性导入脚本（幂等）；
- 检索接口：facts 按 key 精确查 + episodes 按时间窗口查；**远期**（15000 行后）再加 embedding 语义检索（Transformers.js 同运行时复用 + sqlite-vec）；
- 保留现有原子写 / 损坏备份 / 限界（100 条 → 改为按表行数限界）的红线语义。

### 2.4.1 实测结论（2026-10-23）：免 flag 成立，但 API 仍是实验性的

验证脚本 `scripts/verify-sqlite.mjs`（`npm run verify:sqlite`），Node v22.22.2 / win32，**10/10 通过**：

| 项           | 结果                                                        |
| ----------- | --------------------------------------------------------- |
| 免 flag 导入   | ✅ 无需 `--experimental-sqlite`                              |
| WAL 模式      | ✅ `journal_mode=wal`                                      |
| 批量写入 1000 条 | ✅ **7-8 ms**                                              |
| 事务回滚        | ✅ ROLLBACK 后无残留                                           |
| 关闭后重开持久化    | ✅                                                         |
| 损坏文件检测      | ✅ 抛 `ERR_SQLITE_ERROR`（与 JSON store 的 backupCorrupt 语义对齐） |
| 幂等迁移        | ✅ `INSERT OR REPLACE` 按 id                                |
| 落盘体积        | 1001 条约 **160 KiB**（对比 memory.json 上限 1 MiB）              |

**已实现（P10 核心）**：

- `packages/actor/src/memory/sqlite-store.ts`——保持 `load`/`save`/`clear`/`filePath` 与现 JSON store 同签名，可平替；新增幂等迁移 `migrateFromSnapshot`、画像表 `upsertFact`/`queryFacts`、损坏库隔离 `quarantine`、`close`。15 条单测。
- `packages/actor/src/memory/types.ts`——`MemoryStoreLike` 契约。`load`/`save` 允许同步或异步（SQLite 同步、JSON 异步），调用方一律 `await`，两个后端因此可互换。`close` 可选（JSON 不需要，数据库连接需要——Windows 不关会锁文件）。
- `packages/actor/src/memory/migrate.ts`——一次性迁移 `migrateJsonToSqlite` + 首跑探测 `needsMigration`。**绝不删除或改写源文件**，与原 store「损坏文件先备份再覆盖」的红线一致。9 条单测。
- **后端切换已接线**：`createActorServer({ memoryBackend })`，CLI 加 `--memory-backend <sqlite|json>`（默认 sqlite）与 `--migrate-memory`。首次以 SQLite 启动且存在旧 memory.json 时自动导入并打印条数；`server.stop()` 会 `store.close?.()` 释放句柄。
- **顺带修的一个语义隐患**：`MemoryStore.load()` 故意把损坏文件当作空快照返回（读失败不该让 Agent 崩），但迁移必须能区分「空」和「读不了」——否则会把损坏文件静默报成"迁移成功，无内容"。因此新增 `loadWithStatus()` 暴露内部的 corrupt 标志，迁移走这个方法。


**两个必须记下的坑**：

1. **`ExperimentalWarning: SQLite is an experimental feature`**。免 flag ≠ 稳定。空依赖红利是真的，但 API 可能在未来 Node 版本变化。缓解靠**防腐层**：所有 SQLite 访问都封在 `sqlite-store.ts` 一个文件里，将来换实现只动这一处；升级 Node 时跑 `npm run verify:sqlite` + 单测即可发现问题。已在 `actor:start` / `verify:sqlite` 加 `--disable-warning=ExperimentalWarning` 避免污染终端输出。
2. **Vite 5 的内置模块白名单里没有 `node:sqlite`**（Node 22.5 才加入），静态 import 会被解析成名为 `sqlite` 的第三方包而失败。`ssr.external` 与 `test.server.deps.external` 都无效（Vite 先剥掉 `node:` 前缀再匹配）。最终用 `createRequire(import.meta.url)` 动态加载绕开，类型通过 `typeof import("node:sqlite")` 保留。Vite 升级后应改回静态 import。

### 2.5 安全与纯净

口号"超越商业客户端"无法证伪，改为**可验证的安全承诺清单**（每条对应测试/CI 门禁）：

| 承诺       | 机制                                                 | 验证                |
| -------- | -------------------------------------------------- | ----------------- |
| 0 恶意依赖   | 依赖白名单 + lockfile 冻结 + CI 审计**出货依赖树**（`npm audit --omit=dev --audit-level=high`） | 出货树 0 高危（已验证）；开发树告警只报告不阻断，理由见 `docs/prepublish-checklist.md` §2 |
| 0 隐私泄露   | 对话原文不落盘（现状红线）+ SQLite 仅存摘要/画像 + 全程 loopback        | 抓包自测报告            |
| 域名白名单    | manifest host_permissions 最小化 + PageAct 域名白名单      | manifest 契约测试（已有） |
| Token 握手 | **可复用** token（`ReusableToken`）+ Origin 白名单（token-first：无 Origin 跳过，有 Origin 必须命中） | handshake 测试（已有） |
| 沙箱隔离     | opaque origin + CSP `default-src 'none'`（已交付）      | 沙箱契约测试（已有）        |
| 危险操作刹车   | **Actor 每连接令牌桶限流（已交付）** + PageAct 二次确认（待做）+ 循环上限 | 限流与断连测试（已有）；确认流测试待做 |
| 可审计      | **Actor 审计日志（已交付）+ 一键导出（已交付）**                 | 审计事件与导出测试（已有） |

> 「Token 握手」这一行此前写的是「一次性 token」，与代码不符：实现是 `ReusableToken`，**同一个令牌可以反复连接**。这一点必须写准——它的含义是「令牌泄漏长期有效，直到重启 Actor 换令牌」，因此限流与 Origin 白名单是配套控制，而不是可选项。

### 2.5.1 实测结论（2026-10-23）：审计与限流已落地，P11 的核心缺口补齐

P11（安全加固）在路线图里标着「~800 行 / 2 周 / OSV 0 高危」，但审计日志与速率限制此前**根本没有实现**——`ActorServerOptions.log` 是一个从未被调用的死参数，roadmap 里 P2 声称「已交付」的「审计日志」也不存在。本轮补齐：

**审计轨迹**（`packages/actor/src/security/audit-log.ts`）

- 内存环形缓冲，默认 500 条，超出丢最旧；每条记录 `{ts, event, detail}`。
- 事件词表：握手拒绝、令牌拒绝、畸形帧、命令被拒、命令失败、命令成功、被限流、连接关闭。
- **记录前脱敏**：`WebOSLocal-*`、`token=`、`sk-*` 一律替换为 `[redacted]`，详情截断 120 字符。密钥从来没被存下来，所以导出文件不可能泄漏它。
- 导出走新增的 `audit-dump` 命令（只读），sidepanel「导出审计日志」按钮落成 JSON 文件。

**速率限制**（`packages/actor/src/security/rate-limit.ts`）

- 每连接一个令牌桶：默认 10 次/秒、突发 20、连续 5 次违规断连。默认额度很宽松——面板一个会话只发得了几条命令，限流是防洪水不是管正常用法。
- **闸门在解析之前**：被限流的帧根本不进命令路径。
- 已知局限（写进威胁模型）：预算按连接计数，重连即重置——它防失控客户端，不防有动机的本地进程。

**CI 依赖审计**

- 出货依赖树设门禁：`npm audit --omit=dev --audit-level=high`。为此把 `react` / `react-dom` 从 devDependencies 移到 dependencies——它们**确实被打包进产物**（`artifact-runtime.js` / `artifact-sucrase.js`），放在 devDependencies 里会让 `--omit=dev` 漏掉真正出货的两个库。
- 开发工具链（vitest / vite / esbuild）的 6 个已知告警只报告不阻断：全部不进产物，理由与清单在 `docs/prepublish-checklist.md` §2。

**验证**：`packages/actor/test/` 新增 26 条测试（脱敏、环形缓冲、令牌桶、握手/令牌拒绝的审计记录、限流响应与断连），其中限流与审计走**真实 WebSocket 客户端**（`test/ws-client.ts`，手写掩码帧，与生产代码同一套协议），不是只测纯函数。

## 3. 模块间通信架构

```text
                    ┌──────────────────────── Chrome MV3 ────────────────────────┐
                    │                                                            │
  AI 页面 (DeepSeek)│   ┌─────────────┐      ┌──────────────────────────────┐   │
  ┌──────────────┐  │   │ Service     │      │ Offscreen Document (Brain)   │   │
  │ MAIN world   │  │   │ Worker      │      │  └ Dedicated Worker          │   │
  │ sensor-main  │──┼──►│ (路由/状态) │─────►│    Transformers.js v4        │   │
  └──────────────┘  │   │             │      │    WebGPU → WASM fallback    │   │
  ┌──────────────┐  │   │ RouterHost  │      └──────────────────────────────┘   │
  │ ISOLATED     │  │   │ PageActHost │                                         │
  │ sensor-bridge│  │   │ Artifacts   │      ┌──────────────────────────────┐   │
  │ pageact-exec │◄─┼───┤             │      │ Sandbox page (Artifacts)     │   │
  └──────────────┘  │   └──────┬──────┘      │  Sucrase + React UMD         │   │
                    │          │ WS          │  webos.report() → postMessage│   │
                    └──────────┼─────────────┴──────────────────────────────┘   │
                               ▼ 127.0.0.1                                       │
                    ┌──────────────────────┐                                     │
                    │ Actor (Node 22)      │                                     │
                    │  WS server + token   │                                     │
                    │  command allowlist   │                                     │
                    │  memory: node:sqlite │                                     │
                    └──────────────────────┘                                     │
```

**消息流（三条新增通道）**：

1. **Brain 通道**：SW → `chrome.runtime.sendMessage` → offscreen 宿主 → Worker 推理 → 流式回传。用途：页面降噪（抓取文本 → 摘要后注入上下文）、记忆摘要的本地降级通道。
2. **PageAct 通道**：Router 决策 / 用户指令 → SW → content script 执行 DSL → 结果回传 SW → 写入 `SystemContext` 下一轮注入模型。
3. **Artifact 回传通道**：iframe `webos.report()` → sandbox page → SW → `SystemContext.artifactFeedback` → 注入下一轮请求。

所有跨上下文通信复用现有 `CHANNELS` 常量与消息校验（`packages/shared/src/util/validation.ts`），新增消息类型先入 `packages/shared/src/types/messages.ts` 契约层。

## 4. 目录结构规划

```text
packages/
  shared/                 # 契约层（纯 TS，零依赖）—— 新增：
    src/brain/types.ts        # 推理请求/响应/进度事件
    src/act/types.ts          # PageAction DSL + Schema
    src/artifacts/feedback.ts # webos.report() 回传协议
  brain/                  # 【新增】WebGPU 本地推理
    src/offscreen-host.ts     # offscreen document 生命周期
    src/worker.ts             # Dedicated Worker + Transformers.js v4
    src/pipeline.ts           # 降噪 / 摘要 / 提取任务管道
    src/fallback.ts           # WebGPU 探测 + WASM 回退
  page-act/               # 【新增】页面操控
    src/dsl.ts                # Action DSL 校验 ✅ 已建
    src/executor.ts           # 执行器（注入式页面环境，不碰 DOM） ✅ 已建
    src/dom-environment.ts    # 唯一的 DOM 适配层（native setter hack 在这） ✅ 已建
    src/confirm.ts            # 危险操作确认协议（ConfirmRegistry，纯逻辑） ✅ 已建
    src/export.ts             # buildCsv：extract → CSV 组装 ✅ 已建（xlsx 待白名单）
  router/                 # 不变，新增 act 意图规则
  sensor/                 # 不变
  actor/                  # 新增：
    src/memory/sqlite-store.ts  # node:sqlite 三表实现
    src/memory/migrate.ts       # memory.json → SQLite 迁移
  ui/                     # 新增：brain 下载进度页、确认弹窗组件
  apps/
    extension/
      offscreen.html            # 【新增】Brain 宿主页
      src/offscreen.ts          # 【新增】
      src/pageact-host.ts       # 【新增】SW 侧 PageAct 宿主（白名单 + 确认登记） ✅ 已建
      src/pageact-content.ts    # 【新增】PageAct content script（唯一碰 DOM） ✅ 已建
  demo/                     # 不变
docs/
  v2-architecture-plan.md     # 本文档
  v2-brain-modelcard.md       # 模型选型 + A/B 质量门禁报告（P7 交付物）
  v2-pageact-runbook.md       # 操控层验收（P8 交付物）
```

**依赖白名单（V2 新增，共 3 个）**：`@huggingface/transformers`（MIT）、`sucrase`（MIT）、`xlsx`（SheetJS CE，Apache-2.0）。React/ReactDOM 以 UMD 文件 vendored 进扩展，不走 npm 运行时依赖。`node:sqlite` 为 Node 内置，零依赖。

## 5. 分阶段路线图

| 阶段      | 模块              | 交付                                                                          | 行数预算   | 验收门禁                                                        | 周期                      |
| ------- | --------------- | --------------------------------------------------------------------------- | ------ | ----------------------------------------------------------- | ----------------------- |
| **P7**  | Brain           | offscreen 宿主 + Worker + 摘要管道 + WASM 回退 + 下载进度 UI（**模型规格按 §2.1.1 上调至 3B 级**） | ~1,200 | 关闭 Ollama 时记忆闭环仍通；浏览器端用同一套 fixtures 复测，召回率 ≥ Ollama 基线的 90% | 3-4 周                   |
| **P8**  | PageAct         | DSL + 执行器 + 白名单 + 确认 UI + 会话批量导出 CSV/xlsx demo                              | ~1,500 | 合成事件兼容性测试；危险操作不确认不执行（**DSL + 执行器 + 接线 + 确认 UI + 模型触发 + CSV 导出已落地，见 §2.2.1–2.2.4**；xlsx 待白名单） | 3-4 周（**核心已落地**）                   |
| **P9**  | Artifacts React + 画布 | Sucrase 转译 + React IIFE + `webos.report()` 回传闭环 + Sidepanel 画布/自动渲染                              | ~800   | 模型生成交互组件 → 用户点击 → 结果出现在下一轮上下文；headless 8/8                               | 2-3 周（**核心已落地，见 §2.3.1**）                   |
| **P10** | SQLite 记忆       | 三表 schema + 迁移工具 + 检索接口                                                     | ~700   | 迁移幂等；100 条限界语义保留；损坏恢复测试                                     | 2 周（**核心已落地，见 §2.4.1**） |
| **P11** | 安全加固            | 依赖审计 CI + 速率限制 + 审计日志导出 + 威胁模型更新                                            | ~800   | 出货依赖树 0 高危；审计与限流已有 26 条测试（**核心已落地，见 §2.5.1**）；PageAct 二次确认流待做 | 2 周（**核心已落地**）                     |

**总计 12-15 周，净增 ~5,000 行。**

**阶段间依赖**：P7、P8、P9 互相独立可并行（人力够的话）；P10 独立；P11 必须在 P8 之后（速率限制依赖 PageAct 存在）。**建议顺序 P7 → P10 → P9 → P8 → P11**：先拿下最有展示度的本地推理和最稳的记忆升级，把风险最高的操控层放后面。

**远期（15000 行后，不在本规划承诺内）**：embedding 语义检索（复用 Brain 运行时 + sqlite-vec）、第二个站点 adapter（验证中间件抽象）、可选 CDP 层（仅当 P8 明确不够用再议）。

## 6. 红线更新

在现有 4 条红线上追加：

1. **PageAct 不绕过站点风控** —— 被拦就停，不做反检测、不模拟人类行为指纹；
2. **危险操作不确认不执行** —— 下载、表单提交、超过阈值的批量循环必须经用户显式确认；
3. **模型永远不产出 JavaScript** —— 页面操控只有声明式 Action DSL 六种动作，校验闸门严格字段集；没有 `eval`、没有自由代码字段（§2.2.1）；
4. **模型权重来源可审计** —— 仅从 HF 官方仓库下载，校验 SHA-256，记录于 modelcard；
5. **新增依赖必须过白名单 PR** —— 含 license 扫描 + 供应链审计。

## 7. 风险登记册

| 风险                | 等级      | 缓解                                                                          |
| ----------------- | ------- | --------------------------------------------------------------------------- |
| WebGPU 在用户机器不可用   | 高       | WASM 回退 + Ollama 通道兜底，功能永不缺席                                                |
| 1.5B 摘要质量不达标      | **已实测** | 记忆摘要 95% of baseline（可用），降噪不达标（剔除率 16% vs 52%）。→ **模型规格已定为 3B 级**（§2.1.1），降噪明确走 Ollama |
| 小模型指令遵守差（超字数）     | **已实测** | facts 超 40 字比例 43%（3B 为 4%）→ 已加确定性长度守卫，超长条目直接丢弃而非截断1                        |
| 偶发把整段对话写进 facts   | 中       | 30 次推理中出现 1 次。长度守卫已缓解；建议再加 facts 总字符上限（待实现）                                 |
| "零延迟"卖点不成立        | **已确认** | Ollama 同为本机；降噪场景延迟完全相同。对外表述统一改为"零安装、零外传"                                    |
| MV3 CSP 静默阻断推理运行时 | 中       | 官方指南路径：全部资源本地打包，E2E 里加运行时存活探针                                               |
| 合成事件被 SPA 框架忽略    | 中       | native setter hack + MouseEvent fallback，P8 验收含主流框架测试页                      |
| 站点风控拦截批量操作        | 中       | 红线 5：被拦即停，文档明示限制，不做对抗                                                       |
| 模型生成 React 代码 XSS | 低       | 沙箱红线不变 + 回传 schema 校验                                                       |
| 自动渲染 = 无点击执行不可信代码 | 中 | 已判定：安全边界是沙箱隔离而非点击门槛（threat-model 已记录）；UI 常驻提示 + 一键关闭 + 开关持久化 |
| SheetJS CE 许可证    | 低       | Apache-2.0 兼容 MIT，NOTICE 文件注明                                               |
