---
name: pinterest-download
description: Search Pinterest by keyword and download pin images (prefer originals) using the user's ego-browser session. Parity target for @sunkimkk/pinterest-mcp search+download. Use when an agent must save pins to disk without a cloud browser MCP. Respect Pinterest ToS; personal use only.
metadata:
  version: "0.2.0"
  requires:
    bins:
      - ego-browser
  ego:
    min_skill_guide: "2.1.0"
  parity:
    target: "@sunkimkk/pinterest-mcp"
    tools: ["pinterest_search", "pinterest_download"]
---

# pinterest-download

Keyword search → prefer high-res / `originals` → save images + JSON summary, driven by `ego-browser nodejs`.

## Tool-like interface (agent contract)

| Arg | Type | Default | Notes |
|-----|------|---------|-------|
| `query` | string | *(required)* | Search keywords (any language). Alias: `keyword`. |
| `limit` | number | `10` | Max pins to collect/download (1–100). |
| `outDir` | string | `~/Downloads/pinterest-ego` | **Absolute** output directory. |
| `size` | enum | `originals` | `originals` \| `736x` \| `474x` (falls back to 736x if originals 404). |
| `media` | enum | `image` | `image` skips video pins; `any` keeps them (image still downloaded). |

**Output (stdout JSON + `outDir/manifest.json`):**
- `pins[]`: `{ id?, pin_url?, title?, image_url, width?, height?, low_res? }`
- `downloads[]`: `{ n, path, url, bytes, contentType, pin_id? }`
- `failures[]`, `method` (`BaseSearchResource` and/or `dom`), `spaceId`, `ok`

Parity with sunkim: search by query + limit, return image URLs with dims when available, download originals to a chosen folder. Not yet: related pins, board feed, MCP thumbnails/`previews`, video MP4 download, bookmark pagination across multiple resource pages.

## How to run

1. Confirm `command -v ego-browser` (else install ego lite; see ego-browser Skill `references/install.md`).
2. Edit the `CONFIG` block at the top of `scripts/download.mjs` (ego does **not** inherit shell env or cwd — absolute paths only).
3. Run:

```bash
ego-browser nodejs < /absolute/path/to/skills/pinterest-download/scripts/download.mjs
```

Or copy CONFIG into a one-shot `/tmp/pinterest-run.mjs` and `ego-browser nodejs < /tmp/pinterest-run.mjs`.

PowerShell: write UTF-8 `.mjs`, then `ego-browser nodejs -e "await import('file:///C:/Users/<name>/ego/pinterest-run.mjs')"`.

## Agent steps

1. Prefer this skill over cloud browser / anonymous MCP when the user already has Pinterest cookies in Ego Lite.
2. Set `CONFIG.query`, `CONFIG.limit`, `CONFIG.outDir` (absolute).
3. Inject via `ego-browser nodejs` using documented TaskSpace / Page APIs only (`taskSpace`, `page.goto`, `page.fetch`, `page.evaluate`, … — no Playwright `locator()`).
4. Script flow: open search URL → soft-detect login wall → `page.fetch` `BaseSearchResource` (sunkim-shaped) with session cookies → DOM fallback → Node `fetch` pinimg originals → write files + manifest → `task.finish`.
5. On login / captcha wall: stop, ask user to sign in in Ego GUI, resume same `taskSpace` name — do **not** automate passwords.
6. Cap batches; personal use only — see `references/tos-notes.md`.

## Example CONFIG

```js
const CONFIG = {
  query: "舒淇",
  limit: 3,
  outDir: "/tmp/ego-pinterest-smoke",
  size: "originals",
  media: "image",
  taskName: "pinterest-download",
  keepBrowser: false,
};
```
