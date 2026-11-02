# Parity vs `@sunkimkk/pinterest-mcp`

Intent for this skill: **keyword search + save N images**, using Ego Lite cookies instead of sunkim's anonymous HTTP jar.

| Capability | sunkim MCP | this ego skill |
|------------|------------|----------------|
| Keyword search (`query` / `keyword`) | `pinterest_search` | `--query` → `BaseSearchResource` via `page.fetch` (page cookies) |
| How many (`limit` / `count`) | default 20, max 100 | `--count` / `--limit`, default 10, max 100 |
| Bookmark pages | yes | up to 4 resource pages, enough to fill `count` |
| Prefer originals | `size: originals`, fallback 736x | same `resizeUrl` + 736x fallback |
| URLs + width/height | yes | yes when the resource JSON has them |
| Save to a chosen directory | `directory` / `folder` | `--out` + `manifest.json` |
| Session | anonymous cookie jar | Ego Lite profile. Logged out → soft fail (exit 2) unless `--allow-anonymous` |
| Related pins / board feed | yes | not in this skill |
| Thumbnails for the model (`previews`) | yes | not in this skill |
| Video MP4 download | yes | not in this skill (`--media image` skips video pins) |
| Runtime | Node + undici, no browser | `ego-browser nodejs` (argv is inlined by `scripts/download.mjs`) |

`resource_response.message` is a locale status string (for example `确定` / OK). It is not treated as an error. Failures are `HTTP` status, `http_status >= 400`, or `status === "failure"`.
