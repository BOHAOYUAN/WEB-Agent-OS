# Contributing

Thanks for helping. Two things matter more than anything else here: **provenance** and **the red lines**.

## Provenance (hard rule)

- Do **not** copy whole blocks of third-party code, comments, or file structure.
- Reading public documentation and extracting **protocol facts** is fine; implement from scratch and write your own tests.
- Any inspiration must be stated in the PR: the source, and whether you took a fact/idea or code. Code must be MIT-compatible.
- Protocol notes go to `docs/protocol-deepseek.md`, with date and source.

## Development

```bash
npm ci
npm run verify      # typecheck + lint + arch red-line scan + tests + build
npm run demo        # local SSE + PageAct fixtures on :4318
```

- `packages/shared` is the only cross-package contract. `npm run arch` enforces the boundaries and scans for red-line strings.
- New protocol frames: add a fixture first, then change normalization. Tests must cover arbitrary chunk splits.
- Commit messages use `feat:` / `fix:` / `docs:` / `test:` / `chore:`.

## Red lines

See [README](README.md). PRs touching credentials, login, PoW, or request replay are rejected.

## Real-model E2E (optional)

`npm run verify` skips the 6 real-model cases (slow, needs a local Ollama). With `ollama serve` and `ollama pull qwen2.5:3b`:

```powershell
$env:ACTOR_E2E='1'
npx vitest run packages/actor/test/cli-smoke.test.ts packages/actor/test/memory-quality.test.ts
```

Expected: 9 passed, about 8–10 s. Get these green before touching the summary prompt or `normalizeSummary`.

## Docs map

| Want | Read |
| --- | --- |
| Architecture and layer boundaries | [docs/architecture.md](docs/architecture.md) |
| Real-page acceptance (your own login) | [docs/real-deepseek-runbook.md](docs/real-deepseek-runbook.md) |
| Memory loop walkthrough | [docs/ownership-audit.md](docs/ownership-audit.md) |
| Pre-release checks | [docs/prepublish-checklist.md](docs/prepublish-checklist.md) |
| Threat model | [docs/threat-model.md](docs/threat-model.md) |
| V2 plan | [docs/v2-architecture-plan.md](docs/v2-architecture-plan.md) |
| PageAct manual test plan | [docs/pageact-test-plan.md](docs/pageact-test-plan.md) |
