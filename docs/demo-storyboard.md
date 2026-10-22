# 5 分钟演示视频 · 分镜与录制清单

> 目标：让人在 5 分钟内看懂「这是什么、凭什么安全、真跑起来是什么样」。素材全部来自已有证据，不现场编。
> 录屏前先按 [real-deepseek-runbook.md](real-deepseek-runbook.md) 跑通一次。

## 录制前 10 分钟检查

- [ ] `npm run build` 完成，扩展已在 chrome://extensions 重新加载
- [ ] Actor + Ollama 在跑：`powershell -File scripts/autostart.ps1 -DryRun` 里两个端口都是 True
- [ ] 侧边栏已连接（token 已粘贴）
- [ ] DeepSeek 已登录，历史对话清干净，不露出别人的对话或个人信息
- [ ] 书签栏隐藏、页面缩放 110%、窗口 1440x900，OBS 输出 1080p
- [ ] 关掉微信 / QQ / 邮件等通知
- [ ] 只录浏览器窗口和侧边栏，不录桌面

## 分镜

| 时间 | 画面 | 讲的要点 | 证据文件 |
| --- | --- | --- | --- |
| 0:00-0:30 | 架构图（docs/architecture.md 简化版） | 把 AI 网页端变成 Agent 运行时；四层：只读抓流、意图路由、本地桥、侧边栏 UI；不用 API key，不碰账号 | - |
| 0:30-1:30 | 在 DeepSeek 发一条带事实的提问 | 页面自己发请求，扩展只读观察并把流拆成事件；回答结束点「读取当前对话」→「总结当前对话」 | runbook 会话 A |
| 1:30-2:20 | 记忆预览 →「保存到记忆」→「注入下一轮」 | 本地 3B 压成 facts / preferences / open_loops 存到本机；注入下一轮才生效 | real-a-summary.png |
| 2:20-3:00 | F12 → Network → completion → Payload | 前缀顺序：记忆 → 人设 → 原文；只注入一次，失败重试而不是重复 | real-a-payload.png |
| 3:00-3:40 | 刷新页面，再问「我上次说我在做什么」 | 记忆从磁盘读回，不是页面残留 | real-b-inject.png |
| 3:40-4:20 | 让模型生成 HTML 待办 →「读取 Artifacts」→「在沙箱中打开」 | 模型生成的代码在 opaque-origin iframe 里跑，能交互但碰不到扩展 | real-artifacts.png |
| 4:20-4:50 | 沙箱控制台执行 fetch 到 example.com | CSP 直接拦掉，控制台里的 violation 就是证据：纵深防御在拦，不是没生效 | 录屏截帧 |
| 4:50-5:00 | 回到架构图 | 边界：只读、单用户、手动触发；不做鉴权、不做反爬对抗 | - |

## 录制参数

- 1920x1080 / 30fps；不需要画中画；鼠标轨迹可见即可
- OBS：显示器采集裁到浏览器窗口；系统声与麦克风分两轨，方便后期降噪
- 后期加中文硬字幕（关键句），保证静音也能看懂

## 发布后回填

1. 上传 B 站或 YouTube，标题带 Web-OS-Agent；
2. README 的 `## Demo` 段换成链接；
3. 仓库只放 2 张关键帧（real-a-payload.png、real-artifacts.png），不塞整个视频。
