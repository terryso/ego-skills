---
name: __SKILL_ID__
description: TEMPLATE — do not install or ship skills/_template. Replace this description. Drive <site> with Ego Lite via ego-browser. Login-check first and soft-fail with exit 2 when ego-browser is missing or the site is logged out. Never type a password. Use when the user asks to <do the thing>.
metadata:
  version: "0.0.0"
  requires:
    bins:
      - ego-browser
      - node
  ego:
    min_skill_guide: "2.1.0"
---

# __SKILL_ID__

> **TEMPLATE.** `npm run new-skill -- <id>` copies this directory and replaces `__SKILL_ID__`. Do not open a pull request that adds `skills/_template` as a product skill. Delete every TEMPLATE note, replace `https://example.com/login`, and write the real success state before review.

用 Ego Lite 会话完成 **<一句话目标>**。缺 `ego-browser` 或未登录时 soft-fail（退出码 `2`），不要硬调浏览器。

Do the task through Ego Lite. If `ego-browser` is missing or the site is logged out, soft-fail with exit `2`. Do not drive a browser any other way.

## 先装 Ego

先装 **Ego Lite**，保证 `ego-browser` 在 `PATH`。缺失则 soft-fail / 告知用户去装，**不要**改用 Playwright、Puppeteer 或云端浏览器。

Install **Ego Lite** and put `ego-browser` on `PATH`. If it is missing, soft-fail and tell the user. Do not switch to Playwright, Puppeteer, or a cloud browser.

## 每次动作前：登录闸门（必做）

Agent **在上传、下载或改页面之前**必须跑：

```bash
node scripts/check-login.mjs
# 需要把窗口留给人登录时：
node scripts/check-login.mjs --keep
```

| 退出码 | 含义 | Agent 做什么 |
|--------|------|----------------|
| `0` | 已登录 | 把 `login_tip` 告诉用户，继续 |
| `2` | 未登录 / 无 ego-browser | 展示 `how_to_login` / `how_to_login_zh`，**停**。请人在 Ego 里登录后再跑 |
| `1` | 其它错误 | 报告 JSON `error`，不要假装已经成功 |

详见 `references/login.md`。不要另做 cookie-healthcheck。不要代填密码，不要粘贴 Cookie，不要自动扫码。

仓库根目录：`node skills/__SKILL_ID__/scripts/check-login.mjs`。

这个模板在二进制存在时仍返回退出码 `1` 和 `TEMPLATE` 错误。换成真正的 `ego-browser nodejs` 探测后再说技能可用。`wechat-channels-video` 与 `youtube-video` 把这一步拆成 `launch-check.mjs` / `run-check.mjs`；可测试的判断留在 `scripts/lib/pure.mjs`，`ego-deps.mjs` 只放 ego 全局对象。

## 输入

调用方提供路径和文案。本技能**不**写死 `~/…` 或任何个人/产品目录。示例只用 `/tmp/...` 或 `/absolute/path/to/video.mp4`。

## 发布类还是下载类（写清楚再提 PR）

- **发布类：** 调用方提供本地视频绝对路径。技能不下载视频，不内置 yt-dlp / gallery-dl。在下面写明成功态（审核中、私密链接 + 处理状态、进入内容管理或「发布成功」文案、或已存草稿）。需要人扫码的「发表」不要自动点。
- **视频号：** 只存草稿，不点「发表」。
- **下载类：** 和发布类分开。只保存当前 Ego 登录态已经能看到的内容。

### Success state

Replace this sentence with the observable result. Until you do, this template has not succeeded at a real task.

## 测试

```bash
npm test
```

`npm test` 用 glob 收录 `skills/*/scripts/test/*.test.mjs`。c8 统计 `scripts/lib/**/*.mjs`（不含 `ego-deps.mjs`），行覆盖率不低于 80%。
