/**
 * A/B quality fixtures for the V2 Brain model gate.
 *
 * These are SYNTHETIC transcripts written in the register of real DeepSeek
 * sessions about this project (real file paths, real decisions, real numbers).
 * They are NOT captured user data — never claim otherwise in reports.
 *
 * Every fixture deliberately mixes three signal classes so the gate can measure
 * the failure mode that matters: small models habitually write PLANS into
 * `facts`, which poisons later turns with false "already done" claims.
 *   - confirmed facts    → must land in facts
 *   - plans / next steps → must land in open_loops
 *   - stable preferences → must land in preferences
 */

export interface Fixture {
  id: string;
  title: string;
  transcript: string;
  expected: {
    /** Keywords that a correct memory must retain anywhere in its output. */
    recall: string[];
    /** Keywords that must land in `open_loops` (plans, not facts). */
    mustBeOpenLoop: string[];
    /** Keywords that must land in `preferences`. */
    mustBePreference: string[];
  };
}

export const FIXTURES: Fixture[] = [
  {
    id: "f01-v2-plan",
    title: "V2 架构规划：五大能力与路线图",
    transcript: `用户：我想把这个项目做成毕业设计级别的浏览器 AI Agent，五大能力：本地推理、网页操控、Artifacts、持久记忆、安全。目标 5000 行代码。
助手：先纠正一个数字：你现在的代码已经 10111 行了。我按"净增 5000 行、总量 15000 行"重新规划。
用户：那五个能力都要做。
助手：我建议砍掉 CDP 无头浏览器，只做当前页 DOM 操控。原因是它越过你自己定的红线，而且 chrome.debugger 会给用户挂调试横幅。
用户：为什么不用 WebLLM 做本地推理？
助手：摘要和降噪是任务管道，不是 chat。Transformers.js v4 在 2026 年 4 月出了官方 MV3 集成指南，tokenizer 只有 8.3KB 零依赖，更合适。
用户：好，那路线图怎么排？
助手：P7 本地推理 → P10 SQLite 记忆 → P9 React 沙箱 → P8 页面操控 → P11 安全加固。页面操控风险最高，放后面。
用户：下一个阶段做什么？
助手：先做 P7 第一周的 spike，验证 1.5B 模型的摘要质量够不够。
用户：记住，我的回复风格要简洁，别给我情绪价值。`,
    expected: {
      recall: ["10111", "15000", "CDP", "Transformers.js", "P7"],
      mustBeOpenLoop: ["spike", "下一个阶段"],
      mustBePreference: ["简洁"],
    },
  },
  {
    id: "f02-sse-protocol",
    title: "DeepSeek SSE 协议逆向与归一化",
    transcript: `用户：DeepSeek 的流是什么样的？我抓到了好几种帧。
助手：一共有六种帧家族：snapshot 是 {"v":{"response":{"fragments":[...]}}}；新增片段是 {"p":"response/fragments","o":"APPEND"}；路径增量是 {"p":"response/fragments/-1/content","o":"APPEND"}；还有裸增量 {"v":"..."}，这是答案正文的大头；状态帧是 response/status FINISHED；错误帧是带 code 的。
用户：那归一化器怎么写？
助手：我在 packages/shared/src/protocol/deepseek.ts 里实现了，329 行，把 patch/snapshot 流归一化成单调 delta。
用户：测试覆盖了吗？
助手：覆盖了，248 条测试全过，另有 6 条真实模型测试用 ACTOR_E2E=1 开启。
用户：跨平台呢？每家都要写一遍吗？
助手：是的，这是主要成本。Gemini 用 f.req 数组流，Claude 用 SSE event types，各写各的，200 到 400 行一家。
用户：准备什么时候做第二个 adapter？
助手：还没排期，等主线走完再说。`,
    expected: {
      recall: ["六种", "329", "248", "deepseek.ts"],
      mustBeOpenLoop: ["第二个 adapter", "还没排期"],
      mustBePreference: [],
    },
  },
  {
    id: "f03-memory-limits",
    title: "memory.json 存储上限与原子写",
    transcript: `用户：记忆存哪里？
助手：~/.webos-agent/memory.json，由 Actor 进程独占。用的是原子写：先写 tmp 再 rename，崩溃也不会留半个文件。
用户：容量上限是多少？
助手：最多 100 条，最大 1 MiB，超了就从最旧的开始丢。文件损坏时先备份成 .corrupt-时间戳，不会静默覆盖。
用户：原文存吗？
助手：不存。只存摘要器的结构化输出，对话原文不落盘，这是红线。
用户：那 SQLite 什么时候换？
助手：P10 阶段，用 Node 22 内置的 node:sqlite，零新增依赖。预计 700 行。
用户：迁移脚本要做幂等。
助手：对，memory.json 到 SQLite 的一次性导入必须幂等。这个我记下来，等 P10 做。
用户：顺便，我讨厌彩虹屁，批评我要给具体行号。`,
    expected: {
      recall: ["100", "1 MiB", "原子写", "不落盘", "node:sqlite"],
      mustBeOpenLoop: ["P10", "迁移"],
      mustBePreference: ["行号"],
    },
  },
  {
    id: "f04-artifacts-sandbox",
    title: "Artifacts 沙箱的 CSP 契约",
    transcript: `用户：模型生成的代码怎么渲染？
助手：提取代码块，放进 opaque-origin iframe 渲染。关键是没有 allow-same-origin，只有 allow-scripts，CSP 是 default-src 'none'。
用户：能出网吗？
助手：不能。connect-src 'none'，拿不到扩展的 token 和存储。有契约测试守着。
用户：React 代码呢？
助手：现在是 html 和 svg。React 要等 P9，用 Sucrase 转译 JSX，大概 200KB，比 babel-standalone 小一个数量级。
用户：为什么不能用 CDN 加载 React？
助手：因为沙箱 CSP 是 connect-src 'none'，esm.sh 之类的 CDN 在沙箱里根本连不上，必须把 React UMD 打包进扩展。
用户：交互结果能回传给模型吗？
助手：能，计划用 webos.report() 协议，iframe postMessage 回传到 background，再进下一轮的 SystemContext。
用户：好，先做别的，这个排后面。`,
    expected: {
      recall: ["opaque-origin", "allow-same-origin", "Sucrase", "webos.report"],
      mustBeOpenLoop: ["P9", "排后面"],
      mustBePreference: [],
    },
  },
  {
    id: "f05-cross-platform",
    title: "跨平台中间件的可行性评估",
    transcript: `用户：我想让它适配所有平台，能不能改变整个行业？
助手：中间件做得到，改变行业做不到。中间件要改变行业得让平台主动接你，像 MCP 那样，而不是你去适配平台。
用户：那我的抽象够吗？
助手：你的 SiteAdapter 接口设计得不错，matches、isCompletion、createNormalizer 三件套是跨平台的最小面。但缺三样：请求体改写没进 adapter、没有 origin 注册表、抓不到流时静默失效没有降级。
用户：最致命的是什么？
助手：抓流覆盖率。你覆写了 fetch 和 XMLHttpRequest，但 Worker 里发的请求、WebSocket、sendBeacon 全都抓不到。ChatGPT 和 Claude 部分流量走 WS。
用户：host_permissions 呢？
助手：现在只有 chat.deepseek.com。全平台要放开成 all_urls，配 MAIN world 注入加改请求体，是商店审核最高风险档。
用户：那我还是要试试。
助手：给你一个便宜的证伪实验：花三到五天加第二个 adapter，超过三天就证明抽象没降低边际成本，立刻停手。
用户：先放着，我先把主线做完。`,
    expected: {
      recall: ["SiteAdapter", "Worker", "WebSocket", "all_urls"],
      mustBeOpenLoop: ["第二个 adapter", "先放着"],
      mustBePreference: [],
    },
  },
  {
    id: "f06-ollama-summary",
    title: "Ollama 记忆摘要的 facts 边界问题",
    transcript: `用户：记忆摘要的质量怎么保证？
助手：三层。第一层是提示词，明确告诉模型 facts 只放已确认事实，计划一律放 open_loops。第二层是确定性守卫，用正则匹配未来时态标记。第三层是入库前校验。
用户：守卫的正则是什么？
助手：FUTURE_MARKER，匹配"下一步、接下来、待办、待验证、尚未、还没、打算、计划、将会、将要做、要做、需要做、准备"这些词。
用户：为什么是搬运不是删除？
助手：因为方向要安全。已完成的事项落到 open_loops 是无害的，计划落到 facts 是有害的。所以命中守卫的条目搬到 open_loops，不删掉。
用户：3B 模型经常犯这个错吗？
助手：经常。小模型把"下一步做 Stage 2"写成已完成的事实是很典型的错误，注入到下一轮就会污染上下文。
用户：那换个更大的模型？
助手：可以考虑，但先测完 1.5B 的对比例子再说。`,
    expected: {
      recall: ["FUTURE_MARKER", "搬运", "污染", "三层"],
      mustBeOpenLoop: ["换个更大的模型", "先测完"],
      mustBePreference: [],
    },
  },
  {
    id: "f07-actor-security",
    title: "Actor 命令白名单与令牌握手",
    transcript: `用户：Actor 怎么保证安全？
助手：默认拒绝。Origin 校验加一次性 token 握手，命令走白名单和黑名单双层过滤，用无 shell 的 spawn 执行，带 cwd 隔离和硬超时。
用户：token 存在哪？
助手：%LOCALAPPDATA%\\WebOSAgent\\token.txt，只在本机生成，只绑定回环地址，从不写进日志。
用户：心跳和重连处理了吗？
助手：处理了。之前有个 bug，客户端 TCP 重置会让服务端崩掉，已经修了，现在能存活。
用户：命令白名单包括什么？
助手：固定的命令集，不在名单里的一律拒绝，超时也拒绝。
用户：以后要不要加危险操作二次确认？
助手：要，P11 阶段加，配合速率限制和循环上限。
用户：注意别把密钥贴进聊天记录。
助手：这个提醒合理，凭据操作应该你自己在终端完成。`,
    expected: {
      recall: ["Origin", "token", "白名单", "无 shell", "TCP", "心跳"],
      mustBeOpenLoop: ["P11", "二次确认"],
      mustBePreference: [],
    },
  },
  {
    id: "f08-graduation",
    title: "毕设答辩与作品集材料",
    transcript: `用户：毕设要交什么？
助手：源码、DOCX 报告、不超过 20 分钟的答辩录屏，还有 PPT。三个都要。
用户：PicoGrad 那边的旁白怎么做？
助手：火山引擎豆包 TTS，用你自己的声音克隆，36 个分镜，零元方案。
用户：答辩要讲什么？
助手：讲架构分层，为什么这么拆，失败模式是什么。面试官爱听 trade-off，不要只念功能列表。
用户：说课那个呢？
助手：八分钟授课加停顿，按真实口头节奏控字数，口语化能朗读，输出 docx。
用户：初稿别写太长，我会按字数再改。
助手：明白，先给一个严格控字数的版本，再迭代。
用户：还有，材料里别夸大，没做的就写没做。
助手：同意，这是原则。`,
    expected: {
      recall: ["20 分钟", "DOCX", "TTS", "36", "八分钟"],
      mustBeOpenLoop: ["再迭代"],
      mustBePreference: ["别夸大", "控字数"],
    },
  },
  {
    id: "f09-vps-distraction",
    title: "VPS 折腾循环与优先级",
    transcript: `用户：我的 VPS 被机房 null route 了，怎么办？
助手：先停一下。这是你第三次为了 VPS 花时间了，书稿在上面存着确实是问题，但眼下秋招和毕设的 ROI 高得多。
用户：可是书稿只有那一份副本。
助手：那就先把书稿拉下来备份，这一步做完就停，不要再折腾节点和代理了。
用户：好吧，我先把数据拿回来。
助手：对，拿回来就收手。
用户：你说得对，我不该在这种事上反复。
助手：这不是第一次了。判断标准很简单：这件事做完能带来客户或者能推进毕设吗？不能就别碰。
用户：记住这个原则。
助手：记下了。以后你再提 VPS，我就拿这条拦你。`,
    expected: {
      recall: ["null route", "备份", "ROI", "秋招"],
      mustBeOpenLoop: ["拿回来", "停"],
      mustBePreference: ["拦"],
    },
  },
  {
    id: "f10-sensor-taps",
    title: "Sensor 抓流层的覆盖缺口",
    transcript: `用户：Sensor 现在抓得到哪些请求？
助手：MAIN world 里覆写了 fetch 和 XMLHttpRequest，ISOLATED world 的 bridge 做 SSE 分帧，再送到 service worker 的环形缓冲区。
用户：环形缓冲区多大？
助手：每页最多 4000 条事件、150 万字符。合并窗口 16 毫秒，批量刷送 32 毫秒。
用户：抓不到的是什么？
助手：Worker 里发出的请求、WebSocket、还有 sendBeacon，这三种都绕过了我们的钩子。
用户：这算覆盖率缺陷吗？
助手：算。所以在跨平台规划里我把这条列为第一硬伤，覆盖率天然不是百分百，每家大概六成到九成五。
用户：能补吗？
助手：理论上可以注入 Worker 的钩子，但成本高、稳定性差，暂时不做。
用户：那就先记着。
助手：记着了，写进风险登记册。`,
    expected: {
      recall: ["MAIN world", "ISOLATED", "4000", "sendBeacon", "六成"],
      mustBeOpenLoop: ["暂时不做", "先记着"],
      mustBePreference: [],
    },
  },
];
