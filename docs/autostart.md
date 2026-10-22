# 开机自启动（Ollama + Actor）

这个设置只做两件事：

1. 如果 Ollama 端口（默认 11434）没在监听，启动本地 Ollama；
2. 如果 Actor 端口（默认 4319）没在监听，启动 Actor CLI，带上 token 和扩展 Origin 白名单。

脚本本身**不存任何机器相关的值**：项目路径由脚本位置推导，token 和扩展 ID 放在
%LOCALAPPDATA%\WebOSAgent\ 里，第一次运行自动生成。仓库里因此没有密钥、没有绝对路径。

## 安装

在 Windows 启动目录里建一个指向仓库脚本的快捷方式：

~~~text
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\WebOS-Agent-Autostart.lnk
  -> 目标：<仓库>\scripts\autostart.vbs
~~~

为什么用快捷方式而不是直接复制 .vbs：VBS 靠自身位置找 autostart.ps1，复制到启动目录就找不到了；
快捷方式能跨目录指回仓库，同时配置文件里不出现任何绝对路径。

## 首次配置

~~~powershell
# 1) 扩展 ID：chrome://extensions 打开开发者模式，复制已加载扩展的 ID
Set-Content "$env:LOCALAPPDATA\WebOSAgent\extension-id.txt" "<扩展 ID>"

# 2) 便携版 Ollama（不在 PATH 上时必须写，否则脚本跳过 Ollama）
Set-Content "$env:LOCALAPPDATA\WebOSAgent\ollama-exe.txt" "<ollama.exe 路径>"
Set-Content "$env:LOCALAPPDATA\WebOSAgent\ollama-models.txt" "<模型目录>"

# 3) 只看解析结果，不启动任何进程
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\autostart.ps1 -DryRun
~~~

-DryRun 会打印项目路径、token、扩展 ID、Ollama 路径、端口占用情况——自启动失败先看它。

## 本地状态文件

| 文件 | 作用 |
| --- | --- |
| %LOCALAPPDATA%\WebOSAgent\token.txt | Actor 握手 token，首次运行随机生成 |
| %LOCALAPPDATA%\WebOSAgent\extension-id.txt | 允许的 Origin：chrome-extension://<id> |
| %LOCALAPPDATA%\WebOSAgent\ollama-exe.txt | Ollama 可执行文件路径（不在 PATH 上时必填） |
| %LOCALAPPDATA%\WebOSAgent\ollama-models.txt | Ollama 模型目录 |
| %LOCALAPPDATA%\WebOSAgent\autostart.log | 每次登录的启动日志（含失败原因） |

环境变量可覆盖：WEBOS_ACTOR_TOKEN、WEBOS_EXTENSION_ID、WEBOS_OLLAMA_EXE、WEBOS_OLLAMA_MODELS。
Ollama 路径更推荐写上面两个 .txt：已经运行的 Explorer 不一定继承新设的用户环境变量，自启动会读不到。
脚本参数 -Token / -ExtensionId / -OllamaExe / -OllamaModels / -Project / -ActorPort 优先级最高。

## 换 token

~~~powershell
Remove-Item "$env:LOCALAPPDATA\WebOSAgent\token.txt"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\autostart.ps1 -DryRun   # 读出新的 token
~~~

然后重启 Actor 进程，在侧边栏重新粘贴 token 保存。token 只用于 127.0.0.1 回环 + Origin 白名单，
不要发到公开渠道；它也不进版本库。

## 关闭

删掉启动目录里的快捷方式，然后重启或手动结束 Actor / Ollama。

## 注意

- 修改源码后要先 npm run build；自启动只在 dist/actor-cli.js 缺失时才构建。
- 端口被别的进程占用时脚本会跳过，不会杀进程；看日志确认。
- 扩展 ID 只对“加载已解压的扩展程序”的目录稳定：换目录/重新加载会变，记得同步 extension-id.txt。
