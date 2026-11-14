# ego-skills

面向 [ego lite](https://lite.ego.app/) / `ego-browser` 的社区 **Agent Skills**。

让 Codex、Claude、Cursor、OpenClaw 通过 `ego-browser nodejs` 驱动**你自己的 Chromium**（已有 Cookie 和登录态）。

[English](README.md)

> **状态：** [`pinterest-download`](./skills/pinterest-download/)、[`instagram-saved-download`](./skills/instagram-saved-download/)、[`wechat-channels-video`](./skills/wechat-channels-video/)、[`wechat-article-ego`](./skills/wechat-article-ego/)、[`kuaishou-video`](./skills/kuaishou-video/)、[`bilibili-video`](./skills/bilibili-video/)、[`youtube-video`](./skills/youtube-video/)、[`douyin-video`](./skills/douyin-video/)、[`teambition-ego`](./skills/teambition-ego/)、[`x-post`](./skills/x-post/) 和 [`xiaohongshu-ego`](./skills/xiaohongshu-ego/)。需要已安装 [ego lite](https://lite.ego.app/)，并且 `ego-browser` 在 `PATH` 上。计划见 [PLAN.md](./PLAN.md)。只为 Star 的开源项目，[MIT](./LICENSE)。不发布到 npm。

## 安装

下面四种都是现成途径。Claude 插件市场和 `npx skills` 读的是 GitHub **默认分支**（`main`）。改动还在 PR 里时，用方式 3 或 4 从克隆安装。

### 方式 1：Claude Code 插件市场

仓库里的 `.claude-plugin/marketplace.json` 和 `plugin.json` 与 [terryso/claw-skills](https://github.com/terryso/claw-skills) 同一套格式。Claude Code 会加载 `skills/*/SKILL.md`。

```text
/plugin marketplace add terryso/ego-skills
/plugin install ego-skills
```

### 方式 2：npx skills

[`skills`](https://github.com/vercel-labs/skills) 命令行（需要 Node.js 22.20+）会发现 `skills/*/SKILL.md`，并装进它探测到的 Agent，包括 Claude Code、Codex、Cursor、OpenClaw。本仓库自己不发布 npm 包。

```bash
npx skills add terryso/ego-skills
# 只装一个技能、指定一个 Agent：
npx skills add terryso/ego-skills --skill pinterest-download -a claude-code
```

### 方式 3：Git 子模块

```bash
git submodule add https://github.com/terryso/ego-skills.git .agents/ego-skills
./.agents/ego-skills/scripts/install-skills.sh
```

### 方式 4：克隆后复制或做符号链接

```bash
git clone https://github.com/terryso/ego-skills.git
cd ego-skills
./scripts/install-skills.sh            # ~/.agents/skills（Codex 和共用路径）
./scripts/install-skills.sh --agent claude     # ~/.claude/skills
./scripts/install-skills.sh --agent cursor     # ~/.cursor/skills
./scripts/install-skills.sh --agent openclaw   # ~/.openclaw/skills
./scripts/install-skills.sh --all
```

这些目录来自公开的 skills CLI 文档。不传 `--agent` 时，可用 `EGO_SKILLS_HOME` 改默认目标。

本机需要能运行 `ego-browser`（`command -v ego-browser`）。日常浏览器操作仍以 `ego-browser skill` 为准。

## 技能

| 技能 | 做什么 |
|------|--------|
| [`pinterest-download`](./skills/pinterest-download/) | 用 Ego 会话搜索、相关 Pin、画板、给模型看的缩略图，以及图片和 MP4 下载。可选 `--min-width` / `--min-height`。 |
| [`instagram-saved-download`](./skills/instagram-saved-download/) | 下载你自己的 Instagram 收藏。每个技能自己检查登录。 |
| [`wechat-channels-video`](./skills/wechat-channels-video/) | 用 Ego 会话把视频号视频存成草稿。先检查登录。不点「发表」。描述回读、上传等待或封面预览没确认时也不点「保存草稿」。 |
| [`wechat-article-ego`](./skills/wechat-article-ego/) | 在微信公众平台把一篇 Markdown 存成一篇图文草稿，或用 `--kind tietu` 存一篇贴图（type 77）。先检查登录。没有 `--yes` 不上传。`--yes` 只点「保存」或「保存为草稿」。不点「发表」「群发」或「发送预览」。 |
| [`kuaishou-video`](./skills/kuaishou-video/) | 把本地视频发到快手创作者平台。先检查登录。成功标准是「审核中」。上传超时、失败或一直没就绪时不会点发布。 |
| [`bilibili-video`](./skills/bilibili-video/) | 把本地视频投到 B 站。先检查登录。没有 `--yes` 不投稿。`--type` 必须点选并回读，否则停在投稿之前。两张封面各自带回尺寸。成功是审核中，并带 BV 链接，读不到则为 `identity: unconfirmed`。 |
| [`youtube-video`](./skills/youtube-video/) | 把本地视频发到 YouTube Studio。先检查登录。公开范围默认 private，儿童向默认否。成功标准是视频链接加上处理状态。 |
| [`douyin-video`](./skills/douyin-video/) | 把本地视频发到抖音创作者中心。先检查登录。标题最多 30 字。默认公开、允许保存、立即发布。成功标准是进入内容管理或出现「发布成功」。 |
| [`teambition-ego`](./skills/teambition-ego/) | 用 Ego 会话读取 Teambition 测试计划和测试用例。先检查登录。Phase 2a 还能新建、改标题/前置/步骤、改状态，以及把一条用例移到回收站（`delete --yes`）。只走浏览器会话，不用 Open API token。 |
| [`x-post`](./skills/x-post/) | 用已登录的 Ego 会话，通过 `page.fetch` CreateTweet 往 X 发帖。先检查登录。没有 `--yes` 不发送。可选 `--image`（最多 4 张 png/jpeg/webp，每张 ≤ 5 MiB）只在 `--yes` 之后上传。成功标准是 `https://x.com/<screen_name>/status/<id>`。响应丢失或无法确认时结果是 `unknown`：先核对时间线，脚本不会自动重发。 |
| [`xiaohongshu-ego`](./skills/xiaohongshu-ego/) | 在小红书创作者平台发一条视频笔记。先检查登录。没有 `--yes` 不上传。笔记不能带链接，先从文案里删掉，或加 `--strip-links`。传 `--cover`（例如 `cover-3x4.png`）走「选择图片上传」，换成主封面。只传 PK 槽时缩略图会在大约 72 小时内一直是首帧。不传则平台用首帧。成功标准是 `https://www.xiaohongshu.com/explore/<noteId>`。 |

```bash
node skills/pinterest-download/scripts/download.mjs \
  --query wallpaper --count 2 --out "$HOME/Downloads/pinterest-ego"
```

```bash
node skills/instagram-saved-download/scripts/download.mjs \
  --count 5 --out "$HOME/Downloads/instagram-saved"
```

```bash
node skills/wechat-channels-video/scripts/check-login.mjs
```

```bash
node skills/wechat-article-ego/scripts/check-login.mjs
node skills/wechat-article-ego/scripts/save-draft.mjs \
  --markdown /absolute/path/to/article.md
node skills/wechat-article-ego/scripts/save-draft.mjs \
  --kind tietu \
  --title "标题最多二十字" \
  --text "正文。外链保持纯文本。" \
  --image /absolute/path/to/cover.jpg \
  --topic 话题
```

```bash
node skills/kuaishou-video/scripts/check-login.mjs
bash skills/kuaishou-video/scripts/publish.sh /absolute/path/to/video.mp4 "描述 #话题"
```

```bash
node skills/youtube-video/scripts/check-login.mjs
bash skills/youtube-video/scripts/publish.sh /absolute/path/to/video.mp4 "标题" "简介"
```

```bash
node skills/douyin-video/scripts/check-login.mjs
bash skills/douyin-video/scripts/publish.sh /absolute/path/to/video.mp4 "标题" "简介 #话题"
```

```bash
node skills/teambition-ego/scripts/check-login.mjs
node skills/teambition-ego/scripts/tb.mjs testcase parse-url "https://www.teambition.com/project/PROJECT/testplan/PLAN/group/GROUP"
```

```bash
node skills/x-post/scripts/check-login.mjs
node skills/x-post/scripts/post.mjs --text "没有 --yes 时只打印草稿"
node skills/x-post/scripts/post.mjs --text "没有 --yes 时只打印草稿" --image /absolute/path/to/image.png
```

```bash
node skills/xiaohongshu-ego/scripts/check-login.mjs
node skills/xiaohongshu-ego/scripts/post-video.mjs \
  --video /absolute/path/to/video.mp4 --title "标题" --desc "正文" \
  --cover /absolute/path/to/cover-3x4.png
```

如果对应网站还没登录，命令以退出码 `2` 结束，并打印一次性登录步骤，不会替你输入密码。请告诉用户：在 Ego Lite 里登录之后结果才成立（Pinterest 登录后更好；Instagram 收藏在匿名时看不到；视频号登录态过期很快；快手创作者平台没扫码就会停在登录墙；YouTube 在 Ego 里已经登录时上传最稳；抖音在 Ego 里已经登录时发布更稳；Teambition 测试计划要在 Ego 里登录 teambition.com 之后才能读或改；X 发帖要在 Ego 里登录 x.com，并且草稿确认后才加 `--yes`；小红书要在 Ego 里登录创作者平台，计划确认后才加 `--yes`，传了 `--cover` 必须先确认换掉首帧再点发布；公众号图文要在 Ego 里登录 mp.weixin.qq.com，计划确认后才加 `--yes`，看到多个公众号就先停下让人选择）。说明见各技能的 `references/login.md`。

## 为什么用 ego

脚本跑在**你自己的** Ego 配置档里。你平时在用的网站不会像云端浏览器那样再挡一层登录。每个技能就是 markdown 加一个小脚本：`SKILL.md`、`agents/openai.yaml`、`scripts/`、`references/`。

这个仓库只为 Star 和给 Agent 复用。没有 SaaS，没有付费档。路线图见 [PLAN.md](./PLAN.md)。测试：`npm test`（覆盖率写在 [ACCEPTANCE.md](./ACCEPTANCE.md)）。

## 贡献

欢迎为**可运行的 ego-browser 技能**提 PR。不用 `ego-browser` 的 CLI / MCP 包装请放到 [claw-skills](https://github.com/terryso/claw-skills)，或自建仓库后用 `npx skills add` 安装。完整规则（英文）在 [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md)。

- 先开 skill-request issue，再 `npm run new-skill -- <id>`（从 `skills/_template/` 复制骨架）。
- 一个 PR 一个技能。frontmatter 的 bins 含 `ego-browser`。未登录或缺少二进制时 soft-fail，退出码 `2`。不代填密码，不写个人绝对路径，不以 Playwright 作为主路径。
- 视频发布类技能必须在 `SKILL.md` 写明成功态。视频文件由调用方提供本地绝对路径。需要人扫码的「发表」不要自动点。视频号只存草稿。
- 贡献即 MIT（PR 模板勾选，没有 DCO/CLA）。`npm test` 必须通过（c8 行覆盖 ≥ 80%）。PR 和 `main` 上的 GitHub Actions 会跑 `npm ci`、技能卫生检查和 `npm test`。CI 不会登录 Ego。
- 本地 Ego smoke 鼓励去做，但不是合并前提；维护者可以打 `needs-ego-smoke` 标签。

## 许可证

[MIT](./LICENSE)
