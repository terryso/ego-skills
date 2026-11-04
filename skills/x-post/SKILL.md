---
name: x-post
description: >
  Post on X (x.com / twitter.com) through the logged-in Ego Lite session.
  Login-check first and soft-fail with exit 2 when ego-browser is missing or
  x.com is logged out. Sends only with --yes after the draft is shown.
  Uses page.fetch CreateTweet, not the composer click path. Reply is best-effort.
  Use when the user asks to tweet, post, or reply on X or Twitter from Ego.
metadata:
  version: "0.1.0"
  requires:
    bins:
      - ego-browser
      - node
  ego:
    min_skill_guide: "2.1.0"
---

# x-post

用 Ego Lite 里已经登录的 Chromium 会话往 X 发帖。主路径是 `page.fetch` 的 **CreateTweet**，不点「发帖」。

Post to X through the logged-in Ego Lite session. The primary path is `page.fetch` **CreateTweet**. Do not click the composer.

成功标准是 stdout 打出 `https://x.com/<screen_name>/status/<id>`。没有这条链接就不算成功。不要顺手点其它确认框。

Success is the status URL on stdout: `https://x.com/<screen_name>/status/<id>`. Do not click unrelated confirmations.

## 先装 Ego

先装 **Ego Lite**，保证 `ego-browser` 在 `PATH`。缺失则 soft-fail（退出码 `2`），**不要**改用 Playwright、Puppeteer 或云端浏览器。

Install **Ego Lite** and put `ego-browser` on `PATH`. If it is missing, soft-fail with exit `2`. Do not switch to Playwright, Puppeteer, or a cloud browser.

## 每次发帖前：登录闸门（必做）

```bash
node scripts/check-login.mjs
node scripts/check-login.mjs --keep
```

| 退出码 | 含义 | Agent 做什么 |
|--------|------|----------------|
| `0` | 已登录 | 把 `login_tip` 告诉用户，继续 |
| `2` | 未登录 / 无 ego-browser | 展示 `how_to_login` / `how_to_login_zh`，**停** |
| `1` | 其它错误 | 报告 JSON `error`，不要假装已经发出 |

`auth_token` 是 HttpOnly，只存在于浏览器 Cookie 罐。不要打印 Cookie，不要粘贴 Cookie，不要代填密码。

默认 `finish({ keep: [] })`。`--keep` 才把页面留着并 `handOff()`。

## 确认规则

没有 `--yes` 只打印草稿并退出码 `3`，**不发送**。Agent 必须把草稿给人看，等人确认后再加 `--yes`。

Without `--yes` the command prints the draft and exits `3`. It does not send. Show that draft to the user. Add `--yes` only after they confirm.

## 命令

仓库根目录：

```bash
node skills/x-post/scripts/check-login.mjs
node skills/x-post/scripts/post.mjs --text "..."
node skills/x-post/scripts/post.mjs --text "..." --yes
node skills/x-post/scripts/post.mjs --text "..." --reply-to <statusId> --yes
node skills/x-post/scripts/post.mjs --text "..." --yes --json
node skills/x-post/scripts/cleanup.mjs
```

已安装的技能目录里用 `node scripts/...`。

| 退出码 | 含义 |
|--------|------|
| `0` | 已登录，或已发出并打印状态链接，或 cleanup 关掉了本机空间 |
| `3` | 草稿已打印，拒绝发送 |
| `2` | 未登录，或没有 `ego-browser` |
| `1` | 参数、HTTP、GraphQL 或浏览器错误 |

`--json` 打出摘要 JSON。不加 `--json` 且发送成功时，stdout 只有状态链接。

`cleanup` 只对任务空间 `x-post` 执行 `finish({ keep: [] })`。它不删帖。

## 回复

`--reply-to` 会在同一条 mutation 上加 `variables.reply`。2026-11-04 的实页 `page.fetch` 回复返回 GraphQL **226**，**没有**验证成功。当尽力而为：失败就把错误给人，不要改去点回复框，不要重试。

## 短帖和长文

加权长度用 twitter-text v3 的 `maxWeightedTweetLength`（280）。不超过就发 **CreateTweet**。超过，或显式 `--long`，就发 **CreateNoteTweet**（2026-11-04 捕获）。普通 `/compose/post` 的长文就会走这条，不必打开 Articles。

CreateTweet 和 CreateNoteTweet 都带现算的 `x-client-transaction-id`。verification key 和 `loading-x-anim` 从 Ego 页面读。`ondemand.s` 和 `main.*.js` 的地址从页面 DOM / performance 发现后，用 **Node HTTPS** 拉取，不用 `page.fetch`（浏览器 CORS 会让 `abs.twimg.com` 变成 0 字节）。query id 来自这份 Node 拉到的 `main.*.js`。不要复用别的 GraphQL 请求上的 transaction id。长文在材料齐了之后打开 `https://x.com/compose/post`，等两秒，再发。材料不全就退出码 `1`、`sent: false`。也可以传 `--transaction-id`。不要编一个假的。

成功仍然是 `https://x.com/<screen_name>/status/<id>`。长文的完整正文在 `note_tweet.note_tweet_results.result.text`；`legacy.full_text` 会被截断，不当成全文。

## 接口

`queryId` 会随 `main.*.js` 轮换。先从当前包里读对应的 `operationName`，读不到再用 2026-11-04 的捕获值：CreateTweet `l4hk8uVGvR-a8kzQ4nOhPA`，CreateNoteTweet `seOZkIS8AysCGfPo6yYPVA`。不要发明其它 query id。字段见 `references/create-tweet.md`。坑见 `references/pitfalls.md`。

媒体上传、私信、点赞、关注都不做。`media.media_entities` 保持 `[]`。GraphQL **186** 表示这条文本对短帖太长。

## Pro 冒烟（公告原文）

先 `check-login`（退出码 0）。把下面这段原文给人看，确认后再加 `--yes`。成功时 stdout 是 `https://x.com/<screen_name>/status/<id>`。不要删这条公告。

```text
ego-skills x-post: post on X from a logged-in Ego Lite session (page.fetch CreateTweet). Login-check first. Nothing sends without --yes. https://github.com/terryso/ego-skills
```

```bash
node skills/x-post/scripts/post.mjs --text "ego-skills x-post: post on X from a logged-in Ego Lite session (page.fetch CreateTweet). Login-check first. Nothing sends without --yes. https://github.com/terryso/ego-skills"
node skills/x-post/scripts/post.mjs --text "ego-skills x-post: post on X from a logged-in Ego Lite session (page.fetch CreateTweet). Login-check first. Nothing sends without --yes. https://github.com/terryso/ego-skills" --yes
```

## 测试

```bash
npm test
```

`npm test` 用 c8 统计 `scripts/lib/**/*.mjs`（不含 `ego-deps.mjs`），行覆盖率不低于 80%。单测不访问 x.com。
