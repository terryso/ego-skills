# Parity vs `@sunkimkk/pinterest-mcp`

| Capability | sunkim MCP | this ego skill |
|------------|------------|----------------|
| Keyword search (`query` / `keyword`) | `pinterest_search` | CONFIG.query → BaseSearchResource via `page.fetch` |
| `limit` | yes (default 20) | yes (script default often 10; smoke uses 3) |
| Prefer originals / high-res | `image_url` from `orig`; download size `originals` | same resizeUrl + originals→736x fallback |
| Return URLs + dims | yes | yes when resource JSON available |
| Save files to chosen dir | `pinterest_download` `directory`/`folder` | CONFIG.outDir + manifest.json |
| Logged-in cookies | anonymous jar | Ego Lite profile / session |
| Related pins / board feed | yes | **gap** (not in v0.2) |
| Bookmark multi-page | yes | **gap** (single resource page) |
| `previews` thumbnails to model | yes | **gap** |
| Video MP4 download | yes | **gap** (image focus) |
| Headless / no browser | undici only | requires ego-browser |

Approach difference is intentional: ego skill showcases cookie reuse; sunkim is browserless JSON.
