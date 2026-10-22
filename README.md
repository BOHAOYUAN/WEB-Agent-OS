# Web-OS-Agent

> Turn AI web UIs into agent runtimes — an external middleware that **observes, understands, remembers, and acts** inside your own browser.

Web-OS-Agent is a four-layer, decoupled runtime that turns a plain AI chat page (DeepSeek today) into an agent surface without using any API key or touching your credentials. It watches the page's own network traffic, turns the stream into structured events, routes intent, injects persona + memory, runs allowlisted local commands, and renders model-generated code in a sandbox.

<p>
  <img alt="version" src="https://img.shields.io/badge/version-v0.1.0-green">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue">
  <a href="https://github.com/BOHAOYUAN/WEB-Agent-OS/actions/workflows/verify.yml"><img alt="CI" src="https://github.com/BOHAOYUAN/WEB-Agent-OS/actions/workflows/verify.yml/badge.svg"></a>
</p>

<details>
<summary>中文简介（点击展开）</summary>

Web-OS-Agent 把 AI 网页端变成 Agent 运行时：只读地观察你自己浏览器里已经发出的请求，把流拆成结构化事件，按 requestId 配成对话，用本地 3B 模型压成结构化记忆，再把「记忆 + 人设」作为前缀注入下一轮请求；模型生成的 HTML/SVG 在 opaque-origin 沙箱里渲染，出不了网、也碰不到扩展的 token 与存储。

- 不用 API key，不碰账号 / Cookie / Token / PoW；
- 四层解耦：Sensor → Router → Actor → UI；
- 本地优先：记忆总结走 127.0.0.1:11434 的 Ollama，对话原文本不落盘。

定位是毕业设计 + 作品集，MIT。文档入口见 docs/。

</details>

## Demo

**5 分钟演示视频**：待录制，发布后在这里放链接；分镜与录制清单见 [docs/demo-storyboard.md](docs/demo-storyboard.md)。

---

## What it does

| Layer | Role | Status |
|---|---|---|
| **Sensor** | Read-only stream capture (XHR/fetch + SSE framing), never reads auth | ✅ |
| **Router** | Intent rules + persona injection, with loop guard | ✅ |
| **Actor** | Local WS bridge: allowlisted command exec + local memory (`memory-summary` via Ollama, atomic `memory.json`) | ✅ |
| **UI / Artifacts** | Side panel: debug + memory loop + sandboxed code rendering | ✅ |

**Memory loop** — capture → summarize → save → inject next turn, with merged `SystemContext` (memory + persona never overwrite each other), opt-in user-prompt capture, and one-click clear.

**Artifacts sandbox** — fenced code blocks are extracted from answers; html/svg render inside a nested, opaque-origin iframe with a network-blocking CSP. Everything else is read-only. Model output can never reach the extension's token, storage, or the network.

## Architecture

```text
DeepSeek page JS
   │  XHR / fetch (the page's own requests)
   ▼
MAIN world    sensor-main     document_start · observe only, never mutate
   │  raw chunks + allowlisted metadata
   ▼
ISOLATED      sensor-bridge   SSE framing → normalized events
   │  chrome.runtime
   ▼
Service Worker                per-tab ring buffer / session state
   │  port / message
   ▼
Side Panel                    debug · memory loop · artifacts sandbox
```

## Quickstart

**Prerequisites:** Node.js ≥ 22, Chrome/Edge ≥ 116, and a local Ollama for memory summarization.

```bash
npm ci
npm run verify     # typecheck + lint + arch red-line scan + tests + build
npm run build      # → dist/
```

1. Open `chrome://extensions`, enable **Developer mode**, load `dist/`.
2. Start the local Actor via `scripts/autostart.ps1` — it launches Ollama (if not already running) and the Actor CLI, reading the token and extension ID from `%LOCALAPPDATA%\WebOSAgent\` (auto-generated on first run). One-time setup and the `-DryRun` diagnostic are in [docs/autostart.md](docs/autostart.md).
3. Open `https://chat.deepseek.com`, log in with **your own** account, open the side panel, paste the token from `%LOCALAPPDATA%\WebOSAgent\token.txt`.
4. Send a message. Watch the panel capture the stream; ask for a ```html or ```svg block and open it in the sandbox.

> The token is loopback-only and generated on your machine: it lives in `%LOCALAPPDATA%\WebOSAgent\token.txt`, is never written to logs, and is not committed. The extension reads no cookies, tokens, or anti-bot headers.

## Repository layout

```text
packages/shared     single contract layer: types, SSE decode, validation (pure TS)
packages/sensor     MAIN-world observe hooks + ISOLATED-world bridge
packages/router     intent rule engine + persona library + loop guard
packages/actor      local exec bridge: hand-rolled WS + token handshake + allowlist
packages/ui         side-panel debug + artifacts sandbox panels
apps/extension      manifest / service worker / side-panel entry
apps/demo           local SSE mock for offline verification
docs/               architecture, protocol notes, threat model, roadmap
```

## Red lines

1. **Never touch auth** — no cookies/tokens/`Authorization`, no PoW solving, no request replay.
2. **No gray/black-hat** — single user, single browser, manual trigger.
3. **No credential access** — the sensor is read-only; injection rewrites the request body only.
4. **No sandbox escape** — artifacts run in an opaque-origin iframe (`allow-scripts`, never `allow-same-origin`) with `default-src 'none'`.

## Status & roadmap

Core layers (Sensor → Router → Actor → memory loop → Artifacts) are done and covered by 248 tests, plus 6 opt-in real-model tests (`ACTOR_E2E=1`): 1 live Actor CLI integration and 5 memory-quality assertions that pin the facts/plan boundary. Real-browser integration and CSP/sandbox contract tests are included. Roadmap and threat model live in `docs/roadmap.md` and `docs/threat-model.md`.

## License

MIT — see [LICENSE](LICENSE).
