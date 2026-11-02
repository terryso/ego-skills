# ego-skills

面向 [ego lite](https://lite.ego.app/) / `ego-browser` 的社区 **Agent Skills**。

让 Codex、Claude、Cursor、OpenClaw 通过 `ego-browser nodejs` 驱动**你自己的 Chromium**（已有 Cookie 和登录态）。

[English](README.md)

> **状态：** [`pinterest-download`](./skills/pinterest-download/) 和 [`instagram-saved-download`](./skills/instagram-saved-download/)。需要已安装 [ego lite](https://lite.ego.app/)，并且 `ego-browser` 在 `PATH` 上。计划见 [PLAN.md](./PLAN.md)。只为 Star 的开源项目，[MIT](./LICENSE)。不发布到 npm。

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

```bash
node skills/pinterest-download/scripts/download.mjs \
  --query wallpaper --count 2 --out "$HOME/Downloads/pinterest-ego"
```

```bash
node skills/instagram-saved-download/scripts/download.mjs \
  --count 5 --out "$HOME/Downloads/instagram-saved"
```

如果对应网站还没登录，命令以退出码 `2` 结束，并打印一次性登录步骤，不会替你输入密码。请告诉用户：在 Ego Lite 里登录之后结果才成立（Pinterest 登录后更好；Instagram 收藏在匿名时看不到）。说明见各技能的 `references/login.md`。

## 为什么用 ego

脚本跑在**你自己的** Ego 配置档里。你平时在用的网站不会像云端浏览器那样再挡一层登录。每个技能就是 markdown 加一个小脚本：`SKILL.md`、`agents/openai.yaml`、`scripts/`、`references/`。

这个仓库只为 Star 和给 Agent 复用。没有 SaaS，没有付费档。路线图见 [PLAN.md](./PLAN.md)。测试：`npm test`（覆盖率写在 [ACCEPTANCE.md](./ACCEPTANCE.md)）。

## 许可证

[MIT](./LICENSE)
