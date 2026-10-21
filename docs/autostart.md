# 开机自启动（Ollama + Actor）

这个设置只做两件事：

1. 如果 127.0.0.1:11434 没在监听，启动便携 Ollama（模型在 E:\tools\ollama-models）；
2. 如果 127.0.0.1:4319 没在监听，启动 Actor CLI，使用固定 token 和扩展 Origin。

## 安装

把仓库里的 scripts/autostart.vbs 复制到 Windows 启动目录：

~~~text
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\WebOS-Agent-Autostart.vbs
~~~

登录 Windows 后，VBS 会隐藏启动 scripts/autostart.ps1；脚本自己检查端口，避免重复启动。

## 当前固定配置

- token: ***REDACTED***
- extension id: lcmjomcdgiaegbkjlhajcbflkehdhcmh
- Actor: E:\project\Web-OS-Agent\dist\actor-cli.js，端口 4319
- 日志: %LOCALAPPDATA%\WebOSAgent\autostart.log

token 是本地回环 + Origin 白名单用途；不要发到公开渠道。换项目路径、扩展 ID 或 token 时，改 scripts/autostart.ps1 顶部三个常量。

## 关闭

删除启动目录里的 WebOS-Agent-Autostart.vbs，然后重启或手动结束 Actor/Ollama。

## 注意

- 修改源码后要先 npm run build；自启动不会每次重新构建（只在 dist/actor-cli.js 缺失时构建）。
- 侧边栏 token 现在存在 chrome.storage.local，并会在面板打开时自动连接；换 token 后重新粘贴保存即可。
- 如果 4319 被别的进程占用，脚本会跳过，不会杀进程；看日志确认。
