---
name: zhihu-article
slug: ego-zhihu-article
displayName: Ego 知乎文章草稿
summary: 用已登录的 Ego 浏览器准备一篇知乎专栏文章草稿。默认只做离线预览；--save-draft 只保存草稿，不发布。
description: "Prepare one long-form Zhihu article (专栏文章) through the visible zhuanlan editor in Ego Lite. Articles only: not answers, comments, 想法, scheduling, or bulk publishing. Login-check first. Soft-fail with exit 2 when ego-browser is missing, Zhihu is logged out, the session expires, or --expect-account does not match. preview and save-draft without --save-draft are offline and do not open a browser. --save-draft consents to one draft mutation and does not permit publishing. --publish and --yes are refused. Public publishing is not implemented. Success is one numeric draft id, a non-empty readback, and a saved stamp (已保存 or 刚刚 · 草稿). An empty 刚刚 · 草稿 is not success. An unverified receipt reopens that draft URL and does not open /write again. Never report success from a click alone. Use when the user asks for a 知乎文章草稿, 专栏草稿, or zhuanlan.zhihu.com/write."
metadata:
  version: "0.1.0"
  requires:
    bins:
      - ego-browser
      - node
  ego:
    min_skill_guide: "2.1.0"
---

# zhihu-article

用 Ego Lite 里已经登录的知乎会话，准备**一篇**专栏文章草稿。只走看得见的页面。不写回答、评论、想法，不定时，不批量发布。

Prepare **one** Zhihu article draft in the visible editor. `--save-draft` is the only mutation consent. It does not publish. Public publishing is not implemented in this version.

成功不是点到了某个按钮。回读必须同时满足：编辑地址里有唯一的数字草稿 id、正文不是空的、页面有「已保存」或带时间的「刚刚 · 草稿」这类保存戳、标题、正文、标题层级、列表、链接和图片张数都对得上。图片的 alt 不会变成可见说明，不拿它当正文。封面必须是编辑器正文之外的一张 http 预览。没有这条回读，结果是 `unverified` 或 `uploaded`。同一篇的未验证回执会重新打开那一个草稿地址，不会再打开一篇新的 `/write`。空编辑器上的「刚刚 · 草稿」仍然不是成功。

Success is not a click. The editor must show one numeric draft id, a saved stamp, and matching title, body, headings, lists, links, and image count. An empty editor showing 刚刚 · 草稿 is not success. An unverified receipt reopens that draft URL instead of `/write`.

知乎官方说明草稿是自动保存的，保存后页面顶部显示「已保存」；「发布」是另一步（[专栏与文章使用常见问题](https://www.zhihu.com/column/p/20681428)）。如果页面上另外有「保存草稿」「存草稿」或「保存为草稿」，会点一次，而且只点一次。没有这种按钮时，成功路径是自动保存加上回读，`mutation` 为 `autosave-verified`。这两种都不等于发布。

## 先装 Ego

先装 **Ego Lite**，保证 `ego-browser` 在 `PATH`。非交互 shell 找不到时，再试 `~/.local/bin/ego-browser`。仍然缺失则 soft-fail（退出码 `2`）。不要改用 Playwright、Puppeteer 或云端浏览器。

## 登录闸门

```bash
node scripts/check-login.mjs
node scripts/check-login.mjs --expect-account "示例作者"
```

`check-login` 只打开 `https://www.zhihu.com/`，不打开写文章页。账号名来自顶栏身份控件，包括 `header`、`banner`、`AppHeader` 和头像 `AppHeader-profileAvatar`。标志 `AppHeader-zhihuLogo` 不是账号。头像的 `alt`、`aria-label` 或 `title` 若是「点击打开名字的主页」，空格可有可无。推荐流作者不算。`--expect-account` 只和这个名字比较。

写文章页 `https://zhuanlan.zhihu.com/write` 没有「创作中心 / 私信 / 消息」时，只要标题框、正文编辑器和顶栏头像都在，就仍算已登录。打不开探针是 `probe-failed`，验证页是 `challenge`，只有真正落到登录墙才是 `login-expired`。正文优先用 `public-DraftEditor-content`，创作助手里的编辑框不算正文。正文图片只认唯一一个可见控件，它的名字正好是「图片」。空的 `accept`、只是带有「图片」两个字的「AI 配图」、封面、附件、导入、视频和创作助手都不算。对不上这一个输入就停，不猜，也不点「发布」。这种失败会带上页面地址、标题，并在提供了截图目录时把截图写进那个目录。打开写文章页后知乎可能自己出现「刚刚 · 草稿」；那不是本技能确认过的 `draft-saved`。不要代填密码，不要粘贴 Cookie，不要抄 token，不要自动登录。

| 退出码 | 含义 | Agent 做什么 |
|--------|------|----------------|
| `0` | 已登录，且只看到一个匹配的账号 | 把 `login_tip` 告诉用户 |
| `2` | 未登录、登录过期、账号不符，或没有 `ego-browser` | 展示 `how_to_login`，**停** |
| `4` | 顶栏身份控件有多个名字，或已登录但读不到唯一名字（`identity-not-visible`） | **停**。不要猜，也不要用信息流作者凑名字 |
| `3` | 草稿计划已打印，没有写入 | 把计划给人看。没有 `--save-draft` 不打开编辑器 |
| `1` | 参数、素材或浏览器错误 | 报告 JSON `error`，不要假装已保存 |

## 同意和状态

默认是离线预览，不启动浏览器，不写知乎。

| 命令 | 写入？ |
|------|--------|
| `preview` | 否。退出码 `0` 只表示本地计划有效，`state` 为 `not-started` |
| `save-draft` 不加 `--save-draft` | 否。退出码 `3` |
| `save-draft --save-draft` | 是。只同意保存**一篇文章草稿** |
| `--publish`、`--yes` | 直接拒绝。它们不是草稿同意，也不是发布许可 |

`publishPermitted` 和 `publishSupported` 始终是 `false`。

| `state` | 含义 | 可否自动再跑 |
|---------|------|----------------|
| `not-started` | 还没有远程写入 | 预览可以重跑。编辑器里已有内容时不要覆盖 |
| `uploaded` | 图片或封面已提交，但没有确认到草稿 id | 否 |
| `draft-saved` | 回读通过，`verified` 为 true | 否。同一哈希直接返回已有回执 |
| `unverified` | 可能已经有草稿，但身份或正文对不上；包括只看到「已保存」、只点了按钮、自动保存和显式保存分不清 | 否 |
| `failed` | 本地失败，没有观察到远程写入 | 只有 `retryable: true` 时可以修输入后再跑 |

回执在 `--receipt-dir`，默认是用户状态目录下的 `zhihu-article/receipts`。同一哈希如果已经是 `unverified` 或 `uploaded`，下一次会退出 `4`，不再打开编辑器。

## 命令

```bash
node skills/zhihu-article/scripts/check-login.mjs --expect-account "示例作者"
node skills/zhihu-article/scripts/preview.mjs \
  --markdown /absolute/path/to/article.md \
  --cover /absolute/path/to/cover.png
node skills/zhihu-article/scripts/save-draft.mjs \
  --markdown /absolute/path/to/article.md \
  --cover /absolute/path/to/cover.png \
  --expect-account "示例作者" \
  --save-draft --json
node skills/zhihu-article/scripts/cleanup.mjs
```

纯文本用 `--text` 或 `--text-file`，并且必须带 `--title`。正文图片写在 Markdown 里，只接受文章目录内的相对路径或调用方给出的绝对路径。不要写远程图片。

支持的 Markdown：标题、段落、`**粗体**`、`*斜体*`、链接、有序和无序列表、独立一行的本地 PNG/JPG 图片。代码块、表格、引用、原始 HTML、公式、四级及以上标题、嵌套列表、远程图片会在打开浏览器之前被拒绝。GIF 和 WebP 也不接受。封面必须宽于 330px、高于 100px。这些限制来自知乎公开的文章说明，加上本地守卫；本变更没有在真实编辑器里重测选择器和图片是否留下。

细节见 `references/inputs.md`、`references/editor.md`、`references/states.md`、`references/login.md`。本地验收步骤见 `references/acceptance.md`。

## 测试

```bash
npm test
```

单测不打开知乎，也不写入真实账号。单测通过不能当作线上验收。
