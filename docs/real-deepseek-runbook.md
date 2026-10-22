# 真实 DeepSeek 验收 Runbook（25 分钟）

> 目标：用一次会话把 4 条硬门禁全部跑成证据。  
> 执行人：账号本人（agent 不登录、不碰账号、不碰 Cookie/Token）。  
> 产出：`docs/captures/real-*.png` 截图 + `docs/stage2-acceptance-report.md` 第 6 节数据。

## 0. 前置（3 分钟，全部应是通过）

~~~powershell
cd <仓库根目录>
npm run verify                        # 必须全绿（248 passed / 6 skipped）
powershell -File scripts\autostart.ps1 -DryRun   # 确认 token / 扩展 ID / 端口
~~~

- [ ] Actor 在 127.0.0.1:4319 监听（`Get-NetTCPConnection -State Listen -LocalPort 4319`）
- [ ] Ollama 在 127.0.0.1:11434 监听，模型存在（`ollama list` 里有 qwen2.5:3b）
- [ ] chrome://extensions 已加载 `dist/`，扩展 ID 与 `extension-id.txt` 一致
- [ ] 侧边栏「粘贴 Actor token」→「保存 token」→「连接」→ 显示已连接
- [ ] 勾选「允许捕获用户提问 / 仅存本地 ring buffer」

## 1. 会话 A · 埋事实 + 走完保存闭环

**第 1 轮提问（照抄）**

~~~text
我叫皓元，在做 Web-OS-Agent：一个用 Chrome 扩展把 AI 网页端变成 Agent 运行时的项目，
技术栈是 TypeScript + MV3 扩展 + 本地 Node WebSocket。记住这些，别展开。
~~~

等回答结束（面板状态 finished）后，按顺序点：

1.「读取当前对话」→ 下方 transcript 出现 用户/助手 两段；
2.「总结当前对话」→ 记忆预览出现结构化 JSON（facts / preferences / decisions / open_loops）；
3.「保存到记忆」→ 提示已保存；
4.「注入下一轮」→ 只点亮状态，**下一轮**才生效；
5. 截图存 `docs/captures/real-a-summary.png`。

**第 2 轮提问（照抄）**

~~~text
用两句话说明：我上次提到自己在做什么项目？只根据你已有的信息回答。
~~~

6. 打开 F12 → Network → 找 `completion` 请求 → Payload 里看 `prompt`；
7. 确认顺序是 **记忆 → 人设 → 原文**，且每段只出现一次；
8. 截图 Payload 存 `docs/captures/real-a-payload.png`。

**判据**：注入生效时，回答应能说出项目名或技术栈；Payload 里 prompt 以记忆摘要开头。

## 2. 会话 B · 跨会话（重开页面）

刷新 chat.deepseek.com 页面（或新开一个标签），侧边栏：

1.「读取已保存记忆」→ 确认 memory.json 里的 source（tabId / pageSessionId / turnCount）；
2.「注入下一轮」；
3. 提问：`我上次说我的项目叫什么？` 
4. 回答里应出现 Web-OS-Agent（证明记忆是从磁盘合并注入的，不是页面会话残留）；
5. 截图 `docs/captures/real-b-inject.png`。

## 3. 会话 C · 偏好类记忆

1.「清空并停止捕获」→ 再勾选捕获，从零开始；
2. 提问：`以后回答请先给结论，再给理由。`
3. 读取 → 总结 → 保存 → 注入；
4. 下一条随便问一个技术问题，看回答是否先给结论；
5. 截图 `docs/captures/real-c-preference.png`。

## 4. Artifacts（同一会话，5 分钟）

1. 提问：`用 HTML 写一个待办清单，内联 CSS/JS，输出一个完整的 html 代码块。`
2. 面板「读取 Artifacts」→ 出现 1 个 artifact（html，可渲染）；
3.「在沙箱中打开」→ 在 sandbox 页里添加一条待办、勾选 checkbox；
4. 在 sandbox 控制台执行 `fetch('https://example.com')`，应被 CSP 拒绝（`default-src none` / `connect-src none`）；
5. 截图 `docs/captures/real-artifacts.png`。

## 5. 摘要质量记录（3 条）

同一个会话里再跑 2 次「总结当前对话」，按下面模板记录 3 条真实问题（不是猜想）：

| # | 会话 | 问题类型 | 具体现象 | 期望 | 是否致命 |
| --- | --- | --- | --- | --- | --- |
| 1 | A | 例：丢事实 | 摘要没写“Web-OS-Agent” | 应保留项目名 | 否 |
| 2 | B | 例：编造 | 出现对话里没有的内容 | 只写说过的话 | 是 |
| 3 | C | 例：偏好表述太弱 | “偏好先结论”被写成“用户聊过结论” | 应可执行 | 否 |

## 6. 判定表（全部打勾 = 4 条硬门禁关闭）

| 门禁 | 判据 | 结果 | 证据 |
| --- | --- | --- | --- |
| G1 保存+注入 | 会话 A 第 2 轮回答引用第 1 轮事实，Payload 顺序 记忆→人设→原文 | 待填 | real-a-*.png |
| G2 跨会话记忆 | 会话 B 刷新后仍能回答项目名 | 待填 | real-b-inject.png |
| G3 3 次会话 + 3 条质量问题 | 上表 3 行填满 | 待填 | 本文第 5 节 |
| G4 真实 Artifacts | 沙箱内可交互，fetch 被拦 | 待填 | real-artifacts.png |

## 7. 失败排查

| 现象 | 先看 |
| --- | --- |
| 侧边栏连不上 / 401 | token 是否与 `%LOCALAPPDATA%\WebOSAgent\token.txt` 一致；扩展 ID 是否与 `extension-id.txt` 一致 |
| transcript 为空 | 是否勾选捕获；页面是否刷新过（ring buffer 会清） |
| 总结失败 | Ollama 是否在 11434；`curl http://127.0.0.1:11434/api/tags` |
| Payload 里没有记忆 | 「注入下一轮」是在**发送前**点的吗；是否已保存到记忆 |
| 抓不到流 | DeepSeek 是否改版（XHR → fetch/WS）；看 Sensor Debug 的 transport 字段 |

## 8. 红线

- 只用你自己的账号；不导出 Cookie / Authorization / PoW 头；
- 截图前检查浏览器标签栏、头像、邮箱等个人信息，必要时打码；
- 不把真实对话内容贴进 issue 或公开文档。
