# ego-skills

Community **Agent Skills** for [ego lite](https://lite.ego.app/) / `ego-browser`.

Teach Codex, Claude, and Cursor agents to automate a **real Chromium** that already has your cookies and logins — via `ego-browser nodejs`.

> Status: **skeleton**; `#1 pinterest-download` in progress (sunkim search+download parity). See [PLAN.md](./PLAN.md). MIT.

## Quick install (planned)

```bash
# stub — wire up after CascadeProjects → GitHub
./scripts/install-skills.sh
```

Requires `ego-browser` on PATH (`ego-browser skill` for the versioned guide).

## Starter skills (stubs)

| Skill | Intent |
|-------|--------|
| [`pinterest-download`](./skills/pinterest-download/) | Search + download pins (sunkim parity in progress) via logged-in ego session |
| [`web-screenshot`](./skills/web-screenshot/) | Capture full-page / element screenshots |
| [`logged-in-scrape-pattern`](./skills/logged-in-scrape-pattern/) | Canonical reuse-session → extract pattern |

## Why not a cloud browser?

Agents inject scripts into **your** ego profile. No fresh login wall for sites you already use.

## License

[MIT](./LICENSE)
