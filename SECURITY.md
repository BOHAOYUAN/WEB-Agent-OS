# Security

## Reporting

Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) (Security tab → Report a vulnerability).

Never post real cookies, tokens, transcripts, raw frames, or screenshots in a public issue. Reports are acknowledged within 7 days.

## Design constraints (why this can be public)

- **Read-only capture** — no cookies, `Authorization`, `x-hif-*` or `x-ds-pow-response`; the extension makes no network requests of its own; no telemetry, no remote config.
- **Injection only edits the request body** — a single "memory → persona" prefix on the next completion, consumed once; a failure leaves nothing behind.
- **Sandboxed rendering** — model-generated HTML/SVG/JSX runs in a nested iframe inside the manifest sandbox page (`sandbox="allow-scripts"`, never `allow-same-origin`) under `default-src 'none'` / `connect-src 'none'`.
- **Local loopback** — the Actor listens on `127.0.0.1` only; the token is generated on your machine; the Origin allowlist pins the extension id.
- **Transcript never persisted** — only structured summaries are stored, in `~/.webos-agent/memory.db` (SQLite, bounded); the transcript lives in an in-memory ring buffer. Raw-frame export is dev-only.
- **Page actions are declarative and confirmed** — a fixed action DSL, validated twice; dangerous actions (download / submit / credential / destructive) require explicit user confirmation, and no UI means refusal.

## Known boundaries (not vulnerabilities)

- MAIN world shares the page's JS context, so the nonce is visible to same-origin scripts; captured events never trigger privileged actions.
- A page redesign can break capture — usability, not security; record the transport change.
- Single user, manual trigger: no multi-account, no cloud relay, no detection evasion.

## Out of scope

Account security, bot-detection evasion, PoW solving, request replay, proxy/relay schemes.
