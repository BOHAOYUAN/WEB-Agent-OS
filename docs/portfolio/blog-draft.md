# 技术博客 · 大纲 + 初稿（草稿）

> 定位：一篇「不是吹功能，而是讲清工程取舍」的技术长文。目标读者是面试官 / 技术社区。
> 标注 `【初稿】` 的段落可直接用，其余是提纲 + 待补素材。口吻由你统一。

---

## 标题（候选）

**主**：我把 DeepSeek 网页端改造成了一个 Agent 运行时——不碰它的 API，也不碰你的 Cookie

**备**：
- 《零 API、四层解耦：一个把 AI 网页端变成 Agent 的浏览器中间件》
- 《为什么我不用官方 API，偏要在浏览器里"看"大模型的流》

## 副标题 / 摘要

【初稿】DeepSeek 的网页端已经是一个很强的模型入口，但它只是一个聊天框：不跨会话记忆、不能执行本地命令、不能安全渲染模型生成的代码。我用一个四层解耦的 Chrome 扩展把它变成 Agent 表面——全程不读 Token、不碰鉴权，只观察页面自己发出的请求。这篇文章讲清四个工程取舍，以及一个单测抓不到的 bug。

---

## 一、为什么不碰官方 API（约 500 字）

**提纲**：
- 官方 API 拿不到「深度思考」通道和网页端的会话上下文；
- 抓网页端 = 观察页面自己的请求，不是代发/重放，天然绕开账号风险；
- 定位是「中间件」，不是「又一个 API 客户端」。

【初稿】核心是这句话：**我抓的不是"大模型的响应"，而是"页面发给大模型的请求，以及页面收到的流"。** 网页端的一切都发生在你自己的登录会话里，我要做的只是站在旁边看——Main world 里只 `clone` 请求体、只读流，Cookie/Token 根本不在我观察的字段里。这样"零 API"不是口号，是架构上就够不着凭证。

## 二、四层解耦：Sensor → Router → Actor → UI（约 800 字）

**提纲**：
- 每层是独立失败域 + 独立测试域；
- 依赖单向，`packages/shared` 是唯一契约层；
- 用 arch-check 强制，不是靠自觉。

【初稿】拆四层不是为了显得复杂，是因为**每一层出问题时，它必须能被单独关掉、单独测试、单独替换**。Sensor 抓流失败了，不影响 Router；Actor 没启动，不影响你继续看流。这个「可降级」是我在架构里最看重的一点。依赖方向用一条 build 时扫描锁死：谁 import 错方向，构建直接挂。

## 三、MV3 双世界：Main 与 Isolated 的边界（约 600 字）

**提纲**：
- 为什么需要两个世界（Main 看得见页面对象但危险，Isolated 安全但看不见）；
- 白名单字段过边界，凭证不过边界。

【初稿】Chrome 的 content script 有两个世界：MAIN world 能摸到页面的 XHR 原型，但和页面共享一切；ISOLATED world 有扩展自己的 JS 环境，但看不见页面的对象。我把「观察钩子」放 MAIN、把「消息桥接」放 ISOLATED，中间只传白名单字段。这样既抓得到流，又让凭证字段在架构上就过不了边界。

## 四、沙箱威胁模型：让模型代码跑起来，但逃不出去（约 800 字，重点）

**提纲**：
- 需求：模型会生成 html，我要渲染它，但它不可信；
- 四层防御：sandbox 无 same-origin + CSP 无网络 + 只渲染 html/svg + 用户点击才执行；
- 契约测试锁死。

【初稿】渲染模型生成的 HTML，本质是"执行不可信代码"。我的答案是四层防御，缺一层都算输：`iframe sandbox="allow-scripts"` 但**永不加 `allow-same-origin``**（opaque origin，摸不到扩展的 storage/token）；MV3 sandbox 页的 CSP `default-src 'none'` 禁一切网络外传；只渲染 html/svg，其余语言只读；用户显式点击才创建 iframe。这些不是"我觉得安全"，而是写成了单测——`<script>fetch(...)`、`<img onerror>`、`javascript:`、外链 script，一个个断言 sandbox 属性和 CSP 指令。

## 五、三个 trade-off（约 500 字）

**提纲**：
1. **注入 vs 风控**：人设注入改请求体，可能触发 4xx/风控 → 默认关闭、只改 body、失败回退原样发；
2. **本地模型 vs 云端**：记忆总结用本地 Ollama 3B，不耗网页额度、不上云，代价是质量不如大模型 → 用「计划不进 facts」的守卫兜底；
3. **跨轮累积 vs 内存上限**：artifact 跨轮累积，但 ring buffer 有上限，最旧的会被驱逐 → 默认只显示最近一轮，可手动切全部。

## 六、一个单测抓不到的 bug（约 600 字，全文钩子）

【初稿】我测出一个 bug，是所有单测都测不出来的。Artifacts 沙箱第一版是 `iframe.srcdoc = html`，单测全绿——因为测试只断言了 sandbox 属性字符串是 `allow-scripts`。真机一跑，Todo 页面渲染出来了，但 checkbox 点了没反应。原因：**扩展页 iframe 的 srcdoc 不是白纸，它会继承扩展页的 CSP `script-src 'self'`，inline `<script>` 被静默拦截**——不报错，只是失效。最后改成 MV3 `manifest.sandbox` 页 + 双层 iframe，模型文档在内层 sandbox 里作为真文档解析，网络隔离交给 manifest 的 sandbox CSP。这个 bug 教我一件事：浏览器安全模型是分层的，你以为的隔离边界，经常不是真的边界。所以我现在要求：安全不靠感觉，靠契约测试 + 真机验证双重锁死。

## 结尾（约 300 字）

**提纲**：
- 现在的边界：单平台、单用户、手动触发，是纵向切片不是 OS；
- 明确不做的（DOM/WebGPU/多智能体），以及为什么；
- 下一步按 ROI 决定，不为了功能数量加代码。

【初稿】这个项目现在是"扎实的纵向切片"，不是 OS。我只适配了 DeepSeek 一个站点，没做对话 UI，四个护城河一个没碰。但恰恰是知道边界、不乱吹，才让它可信。接下来所有新功能都过同一道门：有真实用户或明确作品集价值，否则不投入。

---

## 素材备忘（写正文时引用，别编数字）

- 测试：248 passed + 6 skipped；真实模型 `ACTOR_E2E=1` 9 passed（qwen2.5:3b）。
- 真实抓流：xhr · answer 673 chars · thinking 590 chars · 92 events。
- 红线扫描：`scripts/arch-check.mjs`（依赖方向 + 凭证/危险 API 扫描）。
- 失败故事：srcdoc 继承 `extension_pages` CSP → 改 `manifest.sandbox` 页（commit 历史里有）。
- 相关文档：`docs/architecture.md` / `docs/threat-model.md` / `docs/artifacts-demo.md`。
