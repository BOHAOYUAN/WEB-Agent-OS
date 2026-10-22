# Stage 2 验收报告

> 日期：2026-10-22  
> 代码基线：v0.1.0 前夕的 main（Stage 2 之后合并了 Artifacts 沙箱与跨轮 scope，见第 10 节）  
> 结论：**本地 E2E 主链路 PASS；真实 DeepSeek 抓流/总结已有用户实测证据；真实 DeepSeek 的保存+注入仍待最后一步。**

---

## 1. 结论

Stage 2 的「捕获 → 读取 → 总结 → 预览 → 保存 → 注入 → 清空」在真实 Chrome + 真实扩展 + 真实本地 Actor + 真实 Qwen2.5-3B + 本地合成页面上通过。

真实 DeepSeek 已确认：

- 网页端 completion 走 **XHR**；
- Sensor 抓到完整流（answer 673 chars / thinking 590 chars / 92 events）；
- 记忆总结能产出结构化结果（188 / 600 字符）。

尚未完成：

- 真实 DeepSeek 上点「保存到记忆」→「注入下一轮」→ 验证下一轮请求体与回答是否真的用上记忆；
- 3 次真实会话的质量评估；
- 2 小时 ownership audit。

---

## 2. 测试环境

| 项 | 值 |
|---|---|
| OS | Windows |
| 浏览器 | Chrome 155.0.8059.85（headless + 真实扩展） |
| Node | v22.14.0 |
| 本地模型 | qwen2.5:3b Q4_K_M，Ollama v0.40.7 |
| 扩展 ID | lcmjomcdgiaegbkjlhajcbflkehdhcmh |
| Actor | 127.0.0.1:4319，本地生成 token + Origin 白名单 |
| 测试页面 | 本地合成页（localhost:4318），模拟 XHR completion |
| 真实页面 | chat.deepseek.com（用户本人账号，用户提供截图） |

---

## 3. 测试结果总览

| 编号 | 测试项 | 方法 | 结果 |
|---|---|---|---|
| T1 | typecheck / lint / arch | npm run verify | PASS |
| T2 | 单元测试 | npm run test | **248 passed / 6 skipped / 32 files** |
| T3 | 扩展构建 | npm run build | PASS |
| T4 | Sensor 抓流 | 本地 XHR 合成流 | PASS |
| T5 | transcript 配对 | user + assistant 按 requestId | PASS（1 轮 / 71 字符） |
| T6 | 3B 总结 | Actor memory-summary | PASS（806ms，ok:true） |
| T7 | 记忆预览 | UI 字符数 ≤600 | PASS（52 / 600） |
| T8 | 保存 + source | memory.json | PASS（tabId / pageSessionId / turnCount） |
| T9 | 合并注入 | 第二条请求体 | PASS（记忆 → 人设 → 原文，单前缀） |
| T10 | 清空并停止捕获 | UI + 文件 + ring | PASS（文件删除 / transcript 空 / 捕获 false） |
| T11 | token 持久化 + 自动连接 | 侧边栏刷新 | PASS |
| T12 | Actor 客户端重置 | TCP reset 回归测试 | PASS（不再崩进程） |
| T13 | 真实 DeepSeek 抓流 | 用户截图 | PASS（xhr / 673 / 590 / 92） |
| T14 | 真实 DeepSeek 保存+注入 | 用户本人 | **未完成** |

---

## 4. 自动化测试

~~~text
npm run verify

typecheck  ✓
lint       ✓
arch       ✓
test       ✓ 248 passed | 6 skipped (254)
build      ✓ dist/
~~~

说明：

- 6 skipped = 1 条 ACTOR_E2E 真实 smoke + 5 条真实模型质量评测；
- 另有 memory-quality 测试需要 ACTOR_E2E=1 才跑。

---

## 5. 本地真实浏览器 E2E

### 5.1 主链路

1. 加载 dist 扩展；
2. Actor 启动并连接；
3. 开启「允许捕获用户提问」；
4. 本地页面发送 XHR completion；
5. 读取当前对话；
6. 总结；
7. 保存；
8. 注入下一轮；
9. 发送第二条消息；
10. 打开 DevTools Network 检查请求体；
11. 清空并停止捕获。

### 5.2 实测数据

| 项 | 结果 |
|---|---|
| transcript | 1 轮 · 71 字符 |
| 用户 | 请帮我写一个 TypeScript 防抖函数 |
| 助手 | 好的，下面是 TypeScript 代码示例。先定义类型，再实现 debounce。 |
| 总结 | ok:true，806ms，qwen2.5:3b |
| 预览 | 52 / 600 字符 |
| source | tabId: 1051499654，pageSessionId: 0e07742b-…，turnCount: 1 |
| 请求数 | 2 |
| 第一条 prompt | 请帮我写一个 TypeScript 防抖函数（无注入） |
| 第二条 prompt | 记忆 → 人设 → 原文（单前缀） |
| personaIdx / originalIdx | 59 / 279 |
| 清空 | 文件删除、transcript 空、捕获 false、提示「已清空…」 |

### 5.3 注入请求体（节选）

~~~json
{
  "prompt": "用户请求编写 TypeScript 防抖函数\n\n---\n\n待办\n- 编写 TypeScript 防抖函数\n\n---\n\nYou are a senior software engineer...\n\n---\n\n请帮我写一个 TypeScript 防抖函数",
  "thinking_enabled": true
}
~~~

结论：记忆、人设、原文三者只出现一次，顺序固定，memory 没被人设覆盖。

---

## 6. 真实 DeepSeek 证据（用户提供）

用户在真实 chat.deepseek.com 会话中观察到：

| 项 | 值 |
|---|---|
| Sensor transport | **xhr** |
| answer | 673 chars |
| thinking | 590 chars |
| events | 92 |
| 状态 | finished |
| transcript | 1 轮 · 699 字符 |
| 记忆摘要 | 188 / 600 字符 |
| facts | 有 |
| preferences | 有 |
| decisions | 空 |
| open_loops | 有 |

这证明 Sensor 的真实页面抓取与 3B 总结已经可用。

**边界**：截图未显示「保存到记忆」和「注入下一轮」后的请求体；因此真实 DeepSeek 的注入闭环仍需最后一步。

---

## 7. 本轮修复

| 问题 | 修复 |
|---|---|
| Actor 在客户端 TCP reset 时因未处理 ECONNRESET 崩溃 | socket error / clientError 处理 + 回归测试（见 fix(actor): 客户端 reset 不再崩溃） |
| 重新加载扩展后需要重新粘贴 token | token 改存 chrome.storage.local，侧边栏打开自动连接（见 feat(dev): 自启动 + token 持久化） |
| 每次重启需要手动启动 Actor | Windows 登录自启脚本启动 Ollama + Actor（见 feat(dev): 自启动 + token 持久化） |
| 固定 token 与绝对路径写死在 autostart 脚本里 | 改为读 %LOCALAPPDATA%\WebOSAgent（首次运行生成 token），仓库不再含密钥和机器路径 |
| 旧 token 进入 git 历史 | token 已轮换作废；零痕迹流程见 docs/prepublish-checklist.md |

---

## 8. 未覆盖 / 已知边界

1. 真实 DeepSeek 的「保存 → 注入」未由自动化验证，需要用户本人完成；
2. 3B 记忆质量未做 3 次真实会话评估；
3. 自动总结（按轮数/字符数）未实现，继续 backlog；
4. 清空后是否继续捕获是刻意取舍：当前「清空并停止捕获」会关闭捕获；
5. 多站点、DOM 操控、WebGPU、多智能体均未开始（Artifacts 沙箱已单独交付，见 docs/artifacts-demo.md）；
6. 没有真实用户、没有发布。

---

## 9. 复现步骤

### 9.1 自动化

~~~powershell
cd <仓库根目录>
npm ci
npm run verify
~~~

### 9.2 本地 E2E

~~~powershell
npm run build
# 先启动你自己的 Ollama（ollama serve，或 autostart 脚本）
node dist/actor-cli.js --allow-origin chrome-extension://<扩展 ID>   # 不带 --token 时自动生成并在启动横幅打印
npm run demo
~~~

1. chrome://extensions 加载 dist；
2. 打开 sidepanel，粘贴 token，保存；
3. 打开 http://localhost:4318，点 XHR 发送；
4. 勾选捕获 → 读取 → 总结 → 保存 → 注入下一轮；
5. 再点 XHR 发送，F12 Network 看 completion 的 Prompt。

### 9.3 真实 DeepSeek

1. 登录自己的账号；
2. 侧边栏确认已连接；
3. 开捕获，发 3 次技术对话；
4. 每次：读取 → 总结 → 保存 → 注入 → 追问 → 看回答是否用上记忆；
5. 记录 3 条摘要质量问题。

---

## 10. 下一步

1. 完成真实 DeepSeek 的保存+注入验证（按 docs/real-deepseek-runbook.md 执行，一次 25 分钟）；
2. 3 次真实会话 + 3 条质量问题记录（同一次会话里的 A/B/C 三组）；
3. 2 小时 ownership audit；
4. 公开仓库前跑一遍 docs/prepublish-checklist.md；
5. 之后才决定要不要做 Stage 3（对话 UI / 多站点）。

**Stage 2 技术闭环已关闭；真实产品闭环尚差用户侧最后一公里。**
