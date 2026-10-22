# 面试 10 问（标准答法草稿）

> 用途：秋招 / 毕设答辩前脱稿演练。每问给「一句话结论 + 展开 + 能甩的证据」。
> 注意：口吻是你的，数据必须是真的（248 tests / 四层 / MV3 sandbox page 等）。

---

## 1. 为什么不用官方 API，反而去抓网页端的流？

**一句话**：因为我要做的是「把现有 AI 网页端变成 Agent 运行时」这个中间件，不是又一个 API 客户端。

**展开**：官方 API 拿不到网页端的「深度思考」通道、不共享网页端的会话上下文和免费额度；而我的定位是「不读任何 Token/Cookie、不碰鉴权」的外部观测层。抓的是**页面自己发出的** XHR/fetch，不是代发、不是重放。

**证据**：`packages/sensor` 里 MAIN world 只 `clone` 请求体、只读不写；`scripts/arch-check.mjs` 有一条红线专门扫 `Authorization`/`getAllResponseHeaders`/Cookie，`npm run verify` 里每次必跑。

## 2. 怎么保证不碰账号 / 凭证？

**一句话**：三层硬隔离 + 一条架构红线扫描。

**展开**：
1. **MAIN world 只观察**：`sensor-main` 在 `document_start` 注入，只读 XHR/fetch 的响应流，绝不读请求头里的 Cookie/Token；
2. **ISOLATED world 桥接**：只有白名单元数据过 `chrome.runtime`，凭证字段根本不过边界；
3. **架构红线**：`arch-check.mjs` 对 `packages/sensor/src` 扫 `Authorization`、`getAllResponseHeaders`、`x-ds-pow-response` 等，命中就 build 失败。

**证据**：README 红线 + `docs/threat-model.md` + 红线扫描是 `verify` 的一环。

## 3. 沙箱逃逸怎么办？（Artifacts 的核心）

**一句话**：四层防御，缺一层都算我输。

**展开**：
1. `iframe sandbox="allow-scripts"` 且**永不 `allow-same-origin`** → opaque origin，摸不到扩展的 storage/token；
2. MV3 `manifest.sandbox` 页的 CSP：`default-src 'none'`、`connect-src 'none'`、`img-src data:` → 禁一切网络外传、外链 img/script；
3. 只渲染 html/svg，其余语言只读展示、绝不执行；
4. **用户显式点击才创建 iframe**，模型输出绝不自动执行。

**证据**：`packages/shared/test/artifacts.test.ts` 对 `<script>fetch(...)`、`<img onerror>`、`javascript:`、`<iframe src>`、外链 script 做了契约测试；真机里 fetch 被拦报 `TypeError`。

**诚实补充**：允许执行的脚本理论上仍能通过「导航 URL 编码」外传自身内容（`connect-src` 管不到 navigation），这与「内联脚本 DoS」同级，是已知残余风险——面试能主动说出来反而是加分。

## 4. 为什么拆成四层（Sensor / Router / Actor / UI）？

**一句话**：每一层是独立的失败域和测试域，依赖只能单向。

**展开**：Sensor 只负责「把流变成事件」，Router 只负责「决策」，Actor 只负责「本地安全执行 + 记忆」，UI 只负责「展示」。`packages/shared` 是唯一契约层，被所有层依赖、它自己不依赖任何层。`arch-check.mjs` 强制这个依赖方向——谁 import 错方向，build 直接挂。

**证据**：`allowedDependencies` 表：`shared: []`、`sensor: ["@webos/shared"]`、`router/actor/ui` 同理。

## 5. 记忆系统怎么保证「计划不被写成已发生的事实」？

**一句话**：三层：prompt 硬约束 + 确定性守卫 + 真实模型质量测试。

**展开**：
1. SYSTEM_PROMPT 硬约束「facts 只放已发生且明确确认的事」，few-shot 给反例；
2. `enforceFactsBoundary` 确定性守卫：命中「下一步/待办/打算/还没」等 FUTURE_MARKER 就把句子从 facts 搬进 open_loops（搬家不删除，错误方向不对称）；
3. `memory-quality.test.ts` 用真实 qwen2.5:3b 跑 5 条固定 transcript，`ACTOR_E2E=1` 才执行，9/9 通过。

**证据**：这条硬不变量现在有机器侧证据（`docs/stage2-acceptance-report.md` §4.1）。

## 6. 注入会不会被 4xx / 风控打断？

**一句话**：注入默认关闭、只改 body 不碰头、失败原样发请求。

**展开**：注入只在用户手动开「人设注入」后才生效；`sensor/src/main/taps` 有专门红线——只允许改写 request body，**禁止** `setRequestHeader`/`getResponseHeader`/`.headers`/`credentials`。任何异常都 try/catch 回退到「原样发请求」。真实页面的 4xx/风控是已知风险，我把它列为 Stage 2.5 的硬门禁，没有真实页面证据就不往下做。

**证据**：`docs/threat-model.md` + arch-check 的 `main/taps` 红线规则。

## 7. 单测测不到的部分，你怎么保证真实页面能跑？

**一句话**：三层：本地合成 demo → headless 真实扩展 E2E → 真人真机验收。

**展开**：本地 SSE demo 验证链路通；headless Chrome + 真实扩展跑 E2E；最后真人登录 DeepSeek 跑 runbook，产出请求体截图作为 G1–G4 证据。**最典型的一个真机才抓到的 bug**：`iframe.srcdoc` 会继承扩展页 CSP `script-src 'self'`，inline script 被**静默**拦截——单测断言的是 sandbox 属性字符串，根本测不出 CSP 继承行为，最后改成 MV3 `manifest.sandbox` 页 + 双层 iframe 才解决。

**证据**：`docs/real-deepseek-runbook.md` + `docs/stage2-acceptance-report.md`。

## 8. 这个项目最大的技术难点 / 最难忘的 bug 是什么？

**一句话**：MV3 里「看起来隔离、其实被 CSP 继承坑了」这件事。

**展开**：上面第 7 问那个 srcdoc 的 bug。难点不在写代码，在于「浏览器安全模型是分层的，你以为的隔离边界经常不是真的边界」——扩展页 iframe 的 srcdoc 不是白纸，它继承 `extension_pages` CSP。这个 bug 教会我：安全不能靠「感觉」，要靠契约测试 + 真机验证双重锁死。

**证据**：`manifest.test.ts` 锁死 sandbox 页声明 + CSP 指令 + parent 校验。

## 9. 这个项目有什么局限 / 边界？（诚实题）

**一句话**：它是「单平台、单用户、手动触发」的纵向切片，不是完整 OS。

**展开**：只适配 DeepSeek 一个站点；没有对话 UI；DOM 操控 / WebGPU / 多智能体四个护城河一个都没做；没有真实用户；记忆是手动触发、没有自动总结和 embedding 检索；注入可能触发目标站点的风控。我把这些明确写进 README 的「不是什么」和 roadmap 的「非目标」里。

**为什么这是加分项**：知道边界、不乱吹，比「我做了个全栈 OS」可信得多。

## 10. 如果重做，你会怎么设计？

**一句话**：把「页面 DOM 适配」和「协议解析」解耦，先做跨站点的统一事件模型。

**展开**：现在 Sensor 的 DeepSeek 归一化是和「XHR/fetch 拦截」耦合的，加第二个站点要改适配层。重做的话我会把「抓流（transport 无关）」和「站点归一化（per-site adapter）」拆成两个可插拔模块，让多站点是「加一个 adapter」而不是「改核心」。另外记忆的滚动合并和 embedding 检索一开始就该进数据模型，而不是事后加。

---

## 附：一句话电梯 pitch（30 秒版）

> 「Web-OS-Agent 把 AI 网页端变成 Agent 运行时——四层解耦的中间件，不碰你的账号和凭证，只观察页面自己的请求，把流变成事件，做意图路由、人设和记忆注入，还能把模型生成的代码在无法逃逸的沙箱里跑起来。248 个测试，真实 Chrome 验收过。」
