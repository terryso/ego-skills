---
name: pinterest-download
description: Search Pinterest and save images or MP4s with the user's Ego Lite cookies. Also related pins, board feeds, and small previews the model can read. Parity with @sunkimkk/pinterest-mcp. Soft-fails if Pinterest is logged out, and always tells the user that signing in inside Ego improves results. Personal use only.
metadata:
  version: "0.4.0"
  requires:
    bins:
      - ego-browser
      - node
  ego:
    min_skill_guide: "2.1.0"
  parity:
    target: "@sunkimkk/pinterest-mcp"
    tools: ["pinterest_search", "pinterest_get_pin", "pinterest_related_pins", "pinterest_board_pins", "pinterest_preview_images", "pinterest_download"]
---

# pinterest-download

用当前 Ego Lite 会话搜索并保存 Pinterest 图片和 MP4。也支持相关 Pin、画板、以及给模型看的小预览图。

Search and save Pinterest images and MP4s with the Ego Lite session. Related pins, boards, and model-facing thumbnails are included.

## Tell the user about login

On every run, **tell the user** the `login_tip` / `login_tip_zh` from the JSON:

Signing in to Pinterest inside Ego Lite improves results compared with anonymous mode. Logged-in results have real numeric pin ids, related pins, and boards that account can open. Anonymous mode still returns public images, but ids are often `e1_…` and related or board lookups are weaker.

如果退出码是 `2`（`login_required: true`），把 `how_to_login` / `how_to_login_zh` 一并给用户，然后停。不要输入密码。详见 `references/login.md`。

## CLI

`ego-browser nodejs` 不转发 shell 参数。下面的命令会把配置写进一个临时模块，再用 `ego-browser nodejs -e "await import('file://…')"` 执行。

```bash
node skills/pinterest-download/scripts/download.mjs --query wallpaper --count 2 --out /tmp/pins
node skills/pinterest-download/scripts/download.mjs search --query wallpaper --count 2 --out /tmp/pins --previews 2
node skills/pinterest-download/scripts/download.mjs related --pin 123456789 --count 4 --out /tmp/pins
node skills/pinterest-download/scripts/download.mjs board --board https://www.pinterest.com/user/board/ --count 4 --out /tmp/pins
node skills/pinterest-download/scripts/download.mjs pin --pin https://www.pinterest.com/pin/123456789/
node skills/pinterest-download/scripts/download.mjs preview --url https://i.pinimg.com/originals/aa/bb/cc/x.jpg
node skills/pinterest-download/scripts/download.mjs download --url https://i.pinimg.com/...jpg --url https://v.pinimg.com/...mp4 --out /tmp/pins
```

| Arg | Default | Notes |
|-----|---------|-------|
| command | `search` | `search` `related` `board` `pin` `preview` `download`. A bare `--query` is still search. |
| `--query` | search only | Any language. |
| `--pin` | | Numeric id, `pinterest.com/pin/…`, or `pin.it`. `e1_…` is rejected. |
| `--board` | | `pinterest.com/<user>/<board>/` or `/user/board/`. |
| `--url` | | Repeatable. `preview` and `download`. MP4 / HLS / cmfv count as video. |
| `--count` | `10` | 1–100 pins. |
| `--out` | `~/Downloads/pinterest-ego` | Absolute path before the browser runs. |
| `--size` | `originals` | `originals` falls back to `736x`. Also `474x`, `236x`. |
| `--media` | `image` | `image` skips video pins. `video` saves MP4. `any` keeps both but still saves the image unless `--media video`. |
| `--previews` | `0` | Up to 8 thumbnails, base64 in the JSON, for the model. |
| `--bookmark` | | Continue a resource page. |
| `--allow-anonymous` | off | Logged-out public results. Default is a soft fail. |
| `--keep` | off | Leave the Pinterest tab open. |

Stdout is one JSON object (Ego 0.6.x also echoes logs on stderr; the CLI copies the summary to stdout). Files plus `manifest.json` go to `--out`. Do not commit them.

Exit `0` when at least one image, video, preview, or pin record is saved. Exit `2` when Pinterest is logged out or the pin/board input is unusable. Exit `1` on other failures.

## Tool surface

| sunkim tool | this CLI |
|-------------|----------|
| `pinterest_search` | `search --query --count --media --bookmark --previews` |
| `pinterest_related_pins` | `related --pin` |
| `pinterest_board_pins` | `board --board` |
| `pinterest_get_pin` | `pin --pin` |
| `pinterest_preview_images` | `preview --url` or `--previews N` |
| `pinterest_download` | `download --url` and the save step on search/related/board/pin |

Checklist: `references/parity-sunkim.md`. Personal use only: `references/tos-notes.md`.

## Agent steps

1. Prefer this skill when the user wants their Pinterest session instead of a cloud browser.
2. Run the CLI with an absolute `--out`. Show the user `login_tip` even when the run succeeds anonymously with `--allow-anonymous`.
3. On exit `2`, show `how_to_login` and stop.
4. On success, report `downloads[].path`, `previews` (if any), and `count`.
