# Web-OS-Agent

> Turn AI web UIs into agent runtimes — an external middleware that **observes, understands, remembers, and acts** inside your own browser.

Web-OS-Agent is a four-layer, decoupled runtime that turns a plain AI chat page (DeepSeek today) into an agent surface without using any API key or touching your credentials. It watches the page's own network traffic, turns the stream into structured events, routes intent, injects persona + memory, runs allowlisted local commands, and renders model-generated code in a sandbox.

<!-- TODO(works-portfolio): add demo GIF + CI/release badges once GitHub is public. -->

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
2. Start the local Actor (autostart helpers in `scripts/`):
   ```powershell
   # Windows: scripts/autostart.vbs → Startup folder (starts Ollama + Actor on login)
   node dist/actor-cli.js --token <token> --allow-origin chrome-extension://<id>
   ```
3. Open `https://chat.deepseek.com`, log in with **your own** account, open the side panel, paste the token.
4. Send a message. Watch the panel capture the stream; ask for a ```html or ```svg block and open it in the sandbox.

> The token is loopback-only and never logged. The extension reads no cookies, tokens, or anti-bot headers.

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

Core layers (Sensor → Router → Actor → memory loop → Artifacts) are done and covered by ~250 tests, including real-browser integration and CSP/sandbox contract tests. Roadmap and threat model live in `docs/roadmap.md` and `docs/threat-model.md`.

## License

MIT — see [LICENSE](LICENSE).
