# 本地记忆总结与记忆系统

> 目标：用**本地小模型**把一段对话压缩成结构化长期记忆，不消耗 DeepSeek 免费额度，也不把对话发到云端。
> 当前状态：**已从独立脚本升级为 Actor 内置能力，并打通 extension 侧「捕获 → 总结 → 保存 → 注入下一轮」闭环**（Stage 2A/2B/2C 完成）。

## 0. 已落地的闭环（Stage 2）

```
DeepSeek 页面
  │ XHR/fetch（opt-in 捕获用户提问）
  ▼
MAIN sensor taps → sensor.user.prompt 事件
  ▼
bridge → SW ring buffer（含 user turns）
  ▼
sidepanel「读取当前对话」→ transcript
  ▼「总结当前对话」
Actor memory-summary（Ollama 127.0.0.1:11434）
  ▼ 预览 → 用户点「保存到记忆」
Actor memory-store（SQLite ~/.webos-agent/memory.db）
  ▼「注入下一轮」
memory.arm → SystemContext 合并（memory → persona 单前缀）→ prompt-inject
```

- **注入合并**：人设（Router）与记忆合并成单一 `SystemContext`，一次消费/ack，互相不覆盖；固定拼装顺序「记忆 → 人设 → 原文」。
- **隐私**：用户提问捕获默认关闭，只存 SW 内存 ring buffer；仅结构化摘要落盘；原始 transcript 永不持久化。
- **质量兜底**：`facts` 只放已确认事实，计划/待办进 `open_loops`（prompt 硬约束 + few-shot + `enforceFactsBoundary` 确定性守卫 + 保存前人工确认）。
- **存储**：默认 `~/.webos-agent/memory.db`（SQLite，Node 内置 `node:sqlite`，**零新增依赖**）；上限 100 条，损坏文件可隔离为 `.corrupt-<ts>`。
  - 旧版为 `~/.webos-agent/memory.json`（原子写 tmp+rename、损坏先备份再覆盖）。**现有行为**：以 sqlite 后端启动且检测到旧 `memory.json` 时会自动导入（原文件保留不动）；`--memory-backend json` 可切回旧后端，导入期间不会删除任何源文件。
  - 迁移是幂等的（`INSERT OR REPLACE` 按 id），可重复执行；源文件损坏时明确报「损坏」而非当成空文件静默跳过。

## 1. 模型选择

| 用途 | 模型 | 量化 | 下载大小 | 建议 |
|---|---|---|---:|---|
| 记忆总结主力 | **Qwen2.5-1.5B-Instruct** | Q4_K_M | ~1.0GB | 先跑；中文够用，CPU 也快 |
| 质量升级 | **Qwen2.5-3B-Instruct** | Q4_K_M | ~2.0GB | 1.5B 太泛、老丢细节时换 |
| 浏览器 WebGPU 实验 | Qwen2.5-1.5B ONNX/MLC | q4f16 | ~1GB | 放 offscreen document；不做主线 |
| 记忆检索（不是总结） | bge-small-zh-v1.5 | — | ~100MB | 以后做 embedding 检索；不能替代总结 |

不建议：DeepSeek-R1-Distill / QwQ（思考 token 浪费）、7B 以上（慢）、Llama 3.2 1B / Gemma 3 1B（中文总结弱）。

## 2. 预计耗时

以 **Qwen2.5-3B-Instruct Q4_K_M**、输出约 300 个汉字、上下文 2–4K token 为例：

| 硬件 | 首次加载 | 单次总结 | 备注 |
|---|---|---:|---|
| RTX 3060 6GB（Ollama CUDA） | 2–5s | **5–10s** | 模型能放进 6GB 显存 |
| CPU（8 核，16 线程） | 1–3s | **20–40s** | 后台任务可接受；上下文越长越慢 |
| 1.5B（同条件） | 1–3s | 约 3B 的 40–60% | 更稳，质量略低 |

- 计时包含模型加载（冷启动）；Ollama 默认 keep_alive=5m，连续总结第二次会快很多。
- 这台 G513QM 的 RTX 3060 有 Modern Standby 后掉 PCIe（Code 45）的问题；如果 GPU 消失，Ollama 会退到 CPU，3B 单次可能到 40s+。**不要设计成必须有 GPU。**
- 上下文不要塞满 8K：总结只保留最近 4000 字符，CPU 预填充才不会拖慢。

### 本机实测（2026-10-22 02:15）

- 便携 Ollama v0.40.7：E:\tools\ollama\ollama.exe
- 模型：E:\tools\ollama-models\qwen2.5:3b（1.9GB）
- 启动：E:\tools\ollama\start-ollama.cmd
- 实测环境：RTX 3060 Laptop 6GB，100% GPU，2.4GB 显存，8192 context
- 643 字对话：冷启动 4.49s，热启动 1.95s（约 116–121 tok/s）
- 1933 字对话：2.44s
- CPU 回退为估算值（20–40s），未实测；dGPU 掉 PCIe 时用 CPU 或重启。

## 3. 安装与运行

~~~powershell
winget install Ollama.Ollama
ollama pull qwen2.5:3b
ollama serve        # 通常安装后已自动在 127.0.0.1:11434
~~~

先验证模型本身：

~~~powershell
ollama run qwen2.5:3b "把下面这段话压缩成一句：..."
~~~

然后用本仓库脚本：

~~~powershell
# 输入格式：.json（[{role,content}] 或 {messages:[...]}）、.jsonl、.txt
npm run memory:summary -- --file .tmp-e2e/transcript.json

# 指定模型 / 先看 prompt 不调用模型
npm run memory:summary -- --file .tmp-e2e/transcript.json --model qwen2.5:3b
npm run memory:summary -- --file .tmp-e2e/transcript.json --dry-run
~~~

输出：同目录下 input.memory.json，包含：

~~~json
{
  "model": "qwen2.5:3b",
  "generatedAt": "2026-10-22T...",
  "source": "...",
  "truncated": false,
  "timing": { "wallSeconds": 8.4, "tokensPerSecond": 42.3 },
  "memory": {
    "facts": ["..."],
    "preferences": ["..."],
    "decisions": ["..."],
    "open_loops": ["..."],
    "summary": "..."
  }
}
~~~

脚本会校验 JSON、裁剪字段长度；模型返回非 JSON 时直接报错，不会写入脏数据。

## 4. 为什么是这套 prompt

- **固定 JSON schema**：小模型最容易在格式上出错；用固定字段 + format=json 把输出约束住。
- **只保留决策/事实/偏好/未完成项**：比自由摘要更适合后续注入，不会把寒暄带进上下文。
- **限制长度**：每条 ≤40 字、summary ≤120 字，控制下一次注入的 token 成本。
- **不确定项进 open_loops**：宁可留待验证，不让模型编造事实。

## 5. 记忆系统还差什么

已落地（Stage 2）：本地摘要、内存存储（Actor memory-store）、opt-in 用户提问捕获、合并注入、保存前人工确认。仍待做：

1. **触发自动化**：目前手动「总结当前对话」；后续可按轮数/字符数自动触发（迁 offscreen document）。
2. **滚动合并**：新摘要与旧摘要合并，避免无限增长；保留可追溯的 source range。
3. **检索**：embedding（bge-small-zh）+ 关键词，取 top-k 注入下一轮 prompt。
4. **多轮指代/工作记忆**：短期工作记忆与长期画像分离。

## 6. 接入位置（以后）

- **不要**把模型放进 content script / MAIN world。
- 推荐：Actor 本地服务调用 Ollama（http://127.0.0.1:11434），扩展通过已有 WebSocket / 本地消息拿摘要。
- 浏览器 WebGPU 版只放 **offscreen document**，作为“无本地服务”的降级方案；不作为主线。
- 记忆内容是用户对话，默认只存本机；导出/上报必须显式确认。

## 7. 红线

- 不调用 DeepSeek 云端做总结，不消耗网页端免费额度。
- 不把原始对话发给第三方服务；Ollama 只在 127.0.0.1。
- 摘要文件可能含用户信息；docs/captures/、.tmp-e2e/ 默认 gitignore，导出前自查。