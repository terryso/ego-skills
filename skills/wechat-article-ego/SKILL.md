---
name: wechat-article-ego
slug: ego-wechat-article-ego
displayName: Ego 微信公众号草稿
summary: 用已登录的 Ego 浏览器把一篇 Markdown 存成一篇微信公众号图文草稿，或把图片存成一篇贴图草稿，只保存，不发表、不群发。
description: "Save one WeChat Official Account (公众号 / mp.weixin.qq.com) article draft, or a 贴图 image post (type 77, --kind tietu), through the visible editor in Ego Lite. Not WeChat Channels. Login-check first. Soft-fail with exit 2 when ego-browser is missing, the console is logged out, or --expect-account does not match. If more than one Official Account is visible, stop before saving and print the names. Nothing is uploaded or saved without --yes. Article mode clicks 保存 / 保存草稿. 贴图 mode clicks 保存为草稿 only and never clicks 预览. Never clicks 发表, 群发, 定时群发, or 发送预览. External URLs in a 贴图 stay plain text. Use when the user asks for a 公众号文章草稿, 图文草稿, 贴图草稿, or mp.weixin.qq.com article."
metadata:
  version: "0.3.0"
  requires:
    bins:
      - ego-browser
      - node
  ego:
    min_skill_guide: "2.1.0"
---

# wechat-article-ego

用 Ego Lite 里已经登录的微信公众平台会话，把一篇 Markdown 文章存成**一篇图文草稿**，或把一张或多张图片存成**一篇贴图草稿**（type 77）。只走 `mp.weixin.qq.com` 上看得见的编辑器。这不是视频号，也不会点「发表」。

Save **one** Official Account article draft, or **one** 贴图 image-post draft, through the visible editor. This is not WeChat Channels. `--yes` clicks 保存 or, for a 贴图, 保存为草稿 only.

成功标准是草稿能按标题或 `appmsgid` 重新打开。图文要核对标题、正文片段和图片张数。贴图要核对 type 77、标题、正文 innerText、话题文字、图片张数和保存时间。没有这条回读就不算成功。

Success is a draft that can be reopened. An article matches title, body text, and image count. A 贴图 matches type 77, title, body innerText, topic texts, image count, and the saved time.

## 先装 Ego

先装 **Ego Lite**，保证 `ego-browser` 在 `PATH`。非交互 shell 找不到时，再试 `~/.local/bin/ego-browser`。仍然缺失则 soft-fail（退出码 `2`），**不要**改用 Playwright、Puppeteer 或云端浏览器。

## 每次保存前：登录闸门

```bash
node scripts/check-login.mjs
node scripts/check-login.mjs --expect-account "账号名称"
```

| 退出码 | 含义 | Agent 做什么 |
|--------|------|----------------|
| `0` | 已登录，且只看到一个公众号（昵称匹配，若传了 `--expect-account`） | 把 `login_tip` 告诉用户，继续 |
| `2` | 未登录 / 昵称不符 / 无 ego-browser | 展示 `how_to_login`，**停**。请人在 Ego 里扫码 |
| `4` | 看到多个公众号，或看不出是哪一个 | 把 `accounts` 给人看，**停在第一次保存之前**。不要猜 |
| `3` | 计划已打印 | 把计划给人看。没有 `--yes` 不上传、不保存 |
| `1` | 其它错误 | 报告 JSON `error`，不要假装已经存成草稿 |

不要另做 cookie-healthcheck。不要代填密码，不要粘贴 Cookie，不要从 URL 里抄 token。任务空间结束时一律 `finish({ keep: [] })`。没有 `--keep`。

## 确认规则

没有 `--yes`：检查登录和账号，打印计划 JSON（标题、图片张数、哈希、保真说明），退出码 `3`。不打开编辑器，不上传。

有 `--yes`：才创建**一篇新草稿**并点「保存」或「保存草稿」。点之前会回读标题、正文和图片张数。对不上就不保存。

同一篇文章（同一哈希）如果回执已经是 `saved`，或者上次结果不确定但草稿箱里能对上标题，就**不再保存一次**。不确定时先对草稿箱，对不上才允许再存一篇。不要盲重点第二次保存，也不要覆盖或删除旧草稿。

## 命令

仓库根目录。调用方传绝对路径。

```bash
node skills/wechat-article-ego/scripts/check-login.mjs --expect-account "账号名称"
node skills/wechat-article-ego/scripts/save-draft.mjs \
  --markdown /absolute/path/to/article.md
node skills/wechat-article-ego/scripts/save-draft.mjs \
  --markdown /absolute/path/to/article.md \
  --source-url https://example.com/post \
  --expect-account "账号名称" \
  --yes --json
node skills/wechat-article-ego/scripts/save-draft.mjs \
  --kind tietu \
  --title "标题最多二十字" \
  --text "正文。外链单独成行，保持纯文本。" \
  --image /absolute/path/to/cover.jpg \
  --topic 话题 \
  --expect-account "账号名称"
node skills/wechat-article-ego/scripts/cleanup.mjs
```

| 退出码 | 含义 |
|--------|------|
| `0` | 已登录，或草稿已在草稿箱确认，或这篇文章之前已经存过，或 cleanup 关掉了本技能的空间 |
| `3` | 计划已打印，没有上传 |
| `2` | 未登录、账号不符，或没有 `ego-browser` |
| `4` | 账号不唯一，或保存结果对不上唯一草稿 |
| `1` | 参数、素材、回读或浏览器错误 |

`--json` 打出摘要 JSON。不加 `--json` 且保存成功时，stdout 是一行 `saved <标题>`。

正文用编辑器的粘贴（`keyboard.paste` 的 text + html）和文件选择（`waitForFileChooser` / `setInputFiles`）。粘贴的 HTML 是浅色正文排版：无衬线正文、带下边线的标题、浅底引用、公众号链接蓝。样式是本技能自己写的行内样式，不内置 mdnice / wechat.bmpi.dev 的 GPL 主题，也不依赖在线编辑器。出处见 `references/typography.md`。图片从 Markdown 引用的本地文件或该文自己的 http(s) 图片下载后上传，不把外链留在正文里。细节见 `references/editor.md`。输入见 `references/inputs.md`。登录见 `references/login.md`。

## 贴图草稿

`--kind tietu` 另存一篇贴图，不走图文编辑器。第一张 `--image` 是封面，其余按顺序上传。`--title` 最多 20 个字符，超了会在打开浏览器之前失败。`--text` 或 `--text-file` 二选一，正文最多 1000 个字符，URL 也算在里面；加上话题之后如果会撑破这 1000 字，同样失败。`--topic` 可重复，只写话题名，不要带 `#`，中间也不要空格。

The same command with `--kind tietu` saves one image post instead of an article. The first `--image` is the cover. `--title` allows 20 characters. `--text` / `--text-file` allow 1000 characters including URLs, and the typed topics have to fit in that same body. Repeat `--topic` with the name only: no `#`, no spaces.

没有 `--yes` 只打印计划并退出 `3`，不开编辑器、不上传。有 `--yes` 也只点一次「保存为草稿」。不点「发表」「预览」「群发」「定时群发」「发送预览」。保存结果对不上这一篇时退出 `4`，不把保存再点一次。编辑器可能会自动保存；自动保存出来的 `appmsgid` 不会被当成可以再开一篇新草稿的理由。

Without `--yes` the command prints the plan and exits `3`. With `--yes` it clicks 保存为草稿 once. It does not click 发表, 预览, 群发, 定时群发, or 发送预览. An outcome that is not this one draft exits `4` and does not click save again. An autosaved `appmsgid` is not a reason to open a second new draft.

贴图编辑器的「链接」只接受公众号内容、小程序或小店。正文里的 `http(s)` 地址保持纯文本行，保存之后也不能点击。不要把外链填进那个链接栏。

The 贴图 link field only accepts Official Account content, a mini program, or a store. Bare `http(s)` URLs stay plain text lines and are not clickable after saving. Do not put an external URL in that link field.

保存成功后会重新打开这篇草稿。重新打开只进入编辑地址并读取，不会点「删除」「废弃」或「不保存」。JSON 里带回 `appmsgid`、`type` 77、`title`、正文 `text`（innerText）、`topics`、`imageCount` 和 `savedTime`。上传若 30 秒内看不到缩略图、文件名、占位消失或上传响应，会把截图和上传区域 HTML 写到截图或回执目录，并把路径放进错误 JSON。编辑器地址、上传控件和话题输入见 `references/tietu.md`。

After a save, the draft is reopened. The JSON includes `appmsgid`, `type` 77, `title`, body `text` (innerText), `topics`, `imageCount`, and `savedTime`. The editor URL, uploader, and topic typing are in `references/tietu.md`.

## 测试

```bash
npm test
```

`npm test` 用 c8 统计 `scripts/lib/**/*.mjs`（不含 `ego-deps.mjs`），行覆盖率不低于 80%。单测不打开微信。
