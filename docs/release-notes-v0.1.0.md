# v0.1.0 — Local-first agent runtime (foundation)

The first public release of **Web-OS-Agent**: a runtime that turns the AI chat page you already use into an agent surface — read-only observation of your own session, local memory, and sandboxed artifacts — with **no API keys and no credentials**.

> This tag is the foundation. The v0.2 work (SQLite memory, PageAct, the artifacts canvas) is on `main` and will ship as the next release.

## Highlights

- **Sensor** — MAIN-world, read-only hooks on XHR / fetch. SSE framing, snapshot dedupe, thinking/answer split, opt-in capture of *your* prompts. It never reads cookies, tokens or anti-bot headers.
- **Router** — keyword intent rules + a small persona library, with a hard iteration guard. If injection fails, the original request goes out unchanged.
- **Actor** — hand-rolled RFC 6455 WebSocket on `127.0.0.1:4319`: token handshake, origin allowlist, heartbeat, a no-shell command runner, local memory summary and atomic memory store.
- **Memory loop** — capture → summarize with a local model → preview → save → inject into the next turn. Merged `SystemContext`, so memory and persona never overwrite each other.
- **Artifacts sandbox** — fenced html/svg blocks render inside an MV3 sandbox page plus a nested iframe (`allow-scripts`, never `allow-same-origin`) under a `default-src 'none'` / `connect-src 'none'` CSP. Everything else is read-only.

## Verification at release

| Gate | Result |
| --- | --- |
| `npm run verify` (typecheck / lint / arch red-line scan / tests / build) | 248 passed + 6 skipped over 32 files |
| Real-model suite (`ACTOR_E2E=1`) | 9 passed: 1 live Actor CLI summary, 5 memory-quality assertions, 3 protocol cases |
| Local real-browser E2E | 9-step main loop PASS, including the injection order "memory → persona → original" |
| Real DeepSeek capture | xhr, answer 673 chars, thinking 590 chars, 92 events (user-captured screenshot) |

The repository's `main` has since moved to **430 tests** and the v0.2 features listed below.

## Install

```powershell
npm ci
npm run verify
npm run build              # -> dist/
scripts\autostart.ps1      # or: node dist/actor-cli.js
```

1. Open `chrome://extensions`, enable Developer mode, load `dist/`.
2. `autostart.ps1` starts Ollama + the Actor; the token is generated at `%LOCALAPPDATA%\WebOSAgent\token.txt`.
3. Open `https://chat.deepseek.com` with **your own** account and paste the token into the side panel.

## Known limitations

- One page version of one site (DeepSeek). A redesign breaks capture — a usability issue, not a security one.
- Memory summarization needs a local Ollama with `qwen2.5:3b`; 3B models lose detail, so the preview must be reviewed before saving.
- Not in this release: auto-summary, rolling merge, embedding retrieval, a conversation UI, multi-site support, model-driven page actions.
- Single user, manual trigger. No telemetry, no cloud relay.

## Next (on `main`, unreleased)

- SQLite memory (`~/.webos-agent/memory.db`) with automatic import of the legacy `memory.json`.
- PageAct: a declarative action DSL with explicit confirmation for dangerous actions.
- The artifacts canvas: React/JSX rendering with `webos.report()` flowing back into the next turn.
- Real-DeepSeek evidence run (G1–G4) — checklist in [`docs/real-deepseek-runbook.md`](https://github.com/BOHAOYUAN/WEB-Agent-OS/blob/main/docs/real-deepseek-runbook.md).

## License

MIT.

---

**中文摘要**

Web-OS-Agent 的第一个公开版本。把 DeepSeek 网页端变成 Agent 运行时：只读观察你自己发出的请求、本地模型总结记忆、模型产出在 opaque-origin 沙箱里渲染。不碰账号与凭证，不经过云端。v0.2 的 SQLite 记忆、PageAct 与画布已在 main 上，随后发布。
