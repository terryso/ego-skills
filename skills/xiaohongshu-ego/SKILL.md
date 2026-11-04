---
name: xiaohongshu-ego
description: >
  Publish one Xiaohongshu (小红书) video note through the creator web UI in Ego Lite.
  Login-check first. Soft-fail with exit 2 when ego-browser is missing, the creator
  site is logged out, or --expect-account does not match the header nickname.
  Nothing is uploaded without --yes. With --cover, 发布 is clicked only after toast
  「已添加 PK 封面」 and the cover counter advances (for example 0/3 to 1/3).
  Without --cover the platform keeps the video first frame. Ego Lite only, not MCP.
  Use when the user asks to post a video note to 小红书 or creator.xiaohongshu.com.
metadata:
  version: "0.1.0"
  requires:
    bins:
      - ego-browser
      - node
  ego:
    min_skill_guide: "2.1.0"
---

# xiaohongshu-ego

用 Ego Lite 里已经登录的创作者会话，发**一条**小红书视频笔记。只走 creator 网页，不走 MCP。

Publish **one** video note through the logged-in creator site. Ego Lite and `ego-browser` only. Not MCP.

成功标准是 stdout 打出 `https://www.xiaohongshu.com/explore/<noteId>`，页面曾出现「发布成功」。没有这条链接就不算成功。

Success is `https://www.xiaohongshu.com/explore/<noteId>` after 「发布成功」.

## 先装 Ego

先装 **Ego Lite**，保证 `ego-browser` 在 `PATH`。缺失则 soft-fail（退出码 `2`），**不要**改用 Playwright、Puppeteer 或云端浏览器。

Install **Ego Lite** and put `ego-browser` on `PATH`. If it is missing, soft-fail with exit `2`. Do not switch to Playwright, Puppeteer, or a cloud browser.

## 封面

传 `--cover` 才会用目录里的封面（例如 `cover-3x4.png`）。上传视频就绪后，对 `input.pk-cover-list-file-input` 做 `setInputFiles`。必须看到 toast「已添加 PK 封面」，并且计数前进（例如 `0/3` → `1/3`），才点「发布」。没有裁剪确认框，不要去点。确认失败就退出，**不要**带着视频首帧发布。

不传 `--cover` 时，平台默认就是视频首帧。技能不会自己造一张封面。

Pass `--cover` to use a directory cover (for example `cover-3x4.png`). After the video is ready, `setInputFiles` on `input.pk-cover-list-file-input`. Click 发布 only after the toast 「已添加 PK 封面」 and the counter advances (for example `0/3` → `1/3`). There is no crop dialog. If that confirmation fails, the run fails and does not publish the first frame.

Without `--cover`, Xiaohongshu keeps the first frame. This skill does not invent a cover.

已经发出的笔记可以事后改封面，但那是尽力而为：`edit-cover.mjs`。保存可能重新进入「审核中」，并出现「封面PK中」。笔记管理里找不到、或更新页「加载失败」时不要重试。优先在第一次发布前换封面。

## 每次发布前：登录闸门

```bash
node scripts/check-login.mjs
node scripts/check-login.mjs --expect-account "听懂AI"
node scripts/check-login.mjs --keep
```

| 退出码 | 含义 | Agent 做什么 |
|--------|------|----------------|
| `0` | 已登录，且昵称匹配（若传了 `--expect-account`） | 把 `login_tip` 告诉用户，继续 |
| `2` | 未登录 / 昵称不符 / 无 ego-browser | 展示 `how_to_login`，**停** |
| `1` | 其它错误 | 报告 JSON `error`，不要假装已经发出 |

`www.xiaohongshu.com` 上的账号可能和创作者平台不是同一个。只看创作者页眉昵称。不要代填密码，不要粘贴 Cookie。

默认 `finish({ keep: [] })`。`--keep` 才把页面留着并 `handOff()`。

## 确认规则

没有 `--yes` 只检查登录并打印计划 JSON（里面有封面路径），退出码 `3`，**不上传**。等人确认后再加 `--yes`。

Without `--yes` the command checks login, prints the plan JSON, and exits `3`. It does not upload. Add `--yes` only after the user confirms.

## 命令

仓库根目录。每次只发一条。调用方传绝对路径，不要写死产品目录。

```bash
node skills/xiaohongshu-ego/scripts/check-login.mjs --expect-account "听懂AI"
node skills/xiaohongshu-ego/scripts/post-video.mjs \
  --video /absolute/path/to/video.mp4 \
  --title "标题" \
  --desc "正文" \
  --topics "#话题1 #话题2" \
  --cover /absolute/path/to/cover-3x4.png \
  --expect-account "听懂AI"
node skills/xiaohongshu-ego/scripts/post-video.mjs \
  --video /absolute/path/to/video.mp4 \
  --title "标题" \
  --desc "正文" \
  --topics "#话题1 #话题2" \
  --cover /absolute/path/to/cover-3x4.png \
  --expect-account "听懂AI" \
  --yes --json
node skills/xiaohongshu-ego/scripts/edit-cover.mjs \
  --note-id <noteId> --cover /absolute/path/to/cover-3x4.png
node skills/xiaohongshu-ego/scripts/cleanup.mjs
```

| 退出码 | 含义 |
|--------|------|
| `0` | 已登录，或已发出并打印 explore 链接，或 cleanup 关掉了本机空间 |
| `3` | 计划已打印，拒绝上传 |
| `2` | 未登录、昵称不符，或没有 `ego-browser` |
| `1` | 参数、封面未确认、或浏览器错误 |

`--json` 打出摘要 JSON。不加 `--json` 且发布成功时，stdout 只有 explore 链接。

`cleanup` 关掉名称以 `xiaohongshu-ego` 开头的任务空间。它不删笔记。

## 不做

图文笔记、定时发布、一次跑多条、MCP、删笔记。发布后改封面不是主路径。

## 测试

```bash
npm test
```

`npm test` 用 c8 统计 `scripts/lib/**/*.mjs`（不含 `ego-deps.mjs`），行覆盖率不低于 80%。单测不访问小红书。

界面步骤见 `references/publish-flow.md`。登录见 `references/login.md`。
