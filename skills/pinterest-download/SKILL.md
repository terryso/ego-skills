---
name: pinterest-download
description: Search Pinterest by keyword and download pin images (prefer originals) with the user's Ego Lite cookies via ego-browser nodejs. Parity target for @sunkimkk/pinterest-mcp search + download. Use when an agent must save pins to disk without a cloud browser. Soft-fails if Pinterest is not logged in. Personal use only.
metadata:
  version: "0.3.0"
  requires:
    bins:
      - ego-browser
      - node
  ego:
    min_skill_guide: "2.1.0"
  parity:
    target: "@sunkimkk/pinterest-mcp"
    tools: ["pinterest_search", "pinterest_download"]
---

# pinterest-download

按关键词搜索 Pin，优先保存原图，用当前 Ego Lite 里的登录态（`ego-browser nodejs`）。

Search by keyword, prefer original images, and save them with the Ego Lite session.

## CLI

`ego-browser nodejs` 不转发额外参数（`process.argv` 只有运行时自身，cwd 是 `/`）。用下面的命令传 `query` / `count` / `out`。脚本会把参数内联后执行 `ego-browser nodejs`。

ego-browser's nodejs runtime does not forward extra arguments. Pass `query`, `count`, and `out` to the script; it inlines them and runs `ego-browser nodejs`.

```bash
node skills/pinterest-download/scripts/download.mjs \
  --query wallpaper --count 2 --out /tmp/ego-pinterest-wallpaper

# or
skills/pinterest-download/scripts/download.sh --query wallpaper --count 2 --out /tmp/ego-pinterest-wallpaper
```

| Arg | Default | Notes |
|-----|---------|-------|
| `--query` / `--keyword` | required | Any language. Positional form: `query count outDir`. |
| `--count` / `--limit` | `10` | 1–100 images. |
| `--out` / `--out-dir` | `~/Downloads/pinterest-ego` | Resolved to an absolute path before the browser run. |
| `--size` | `originals` | `originals` \| `736x` \| `474x`. Originals fall back to 736x. |
| `--media` | `image` | `image` skips video pins. `any` still saves the image. |
| `--keep` | off | Leave the Pinterest tab open (`finish({ keep: ["p1"] })`). |
| `--allow-anonymous` | off | Logged-out public search. Default is a soft fail. |

The CLI prints one JSON object on stdout (Ego Lite 0.6.x also echoes script logs on stderr; the CLI copies the summary back to stdout). Files land in `--out` plus `manifest.json`. Exit `0` when at least one image is saved, `2` when Pinterest is logged out (or the command line is invalid), `1` on other failures.

## Logged-out soft fail

If the Ego profile is not signed in to Pinterest, the script does **not** type a password. It prints `login_required: true`, writes `manifest.json`, closes the task space, and exits `2`.

一次性登录：

1. 打开 Ego Lite（与 `ego-browser` 同一个配置档）。
2. 手动打开 https://www.pinterest.com/login/ 并登录。不要让代理填写密码。
3. 保持登录，然后重新运行上面的命令。
4. 若 Chrome 里已经登录，可以 `ego-browser import --browser chrome --profile Default`，再在 Ego 窗口里确认。

Details: `references/login.md`. Pass `--allow-anonymous` only when logged-out public results are acceptable. Pass `--keep` if the user should sign in on the already-open tab.

## Agent steps

1. Prefer this skill over a cloud browser when the user wants their Pinterest session.
2. Run the CLI with an absolute `--out` directory. Do not commit images or `manifest.json`.
3. On exit `2`, show `how_to_login` / `how_to_login_zh` and stop. Resume only after the user says they signed in.
4. On success, report `downloads[].path` and `count`. Personal use only — `references/tos-notes.md`.

## Scope vs sunkim

In: keyword search (`BaseSearchResource`, up to 4 bookmark pages) and image download to a chosen directory, using the Ego cookie jar.

Out: related pins, board feeds, model-facing thumbnails, video MP4 download. See `references/parity-sunkim.md`.
