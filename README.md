# ego-skills

Community **Agent Skills** for [ego lite](https://lite.ego.app/) / `ego-browser`.

面向 [ego lite](https://lite.ego.app/) / `ego-browser` 的社区 **Agent Skills**。

Teach Codex, Claude, and Cursor to automate a **real Chromium** that already has your cookies — via `ego-browser nodejs`.

让 Codex、Claude、Cursor 通过 `ego-browser nodejs` 驱动**你自己的 Chromium**（已有 Cookie 和登录态）。

> **Status / 状态:** first skill shipping — [`pinterest-download`](./skills/pinterest-download/)（搜索并下载 Pin）。`web-screenshot` 与 `logged-in-scrape-pattern` 仍是骨架。计划见 [PLAN.md](./PLAN.md)。Star-only OSS，[MIT](./LICENSE)。

English and 中文 below are both first-class. 下面的英文和中文都是正文，不是附录。

---

## English

### Install

1. Install [ego lite](https://lite.ego.app/) and finish onboarding so `ego-browser` is on `PATH`.
2. Check it: `command -v ego-browser && ego-browser skill | head`.
3. Clone this repo and link the skills into the agent skills directory:

```bash
git clone https://github.com/terryso/ego-skills.git
cd ego-skills
./scripts/install-skills.sh
```

That symlinks `skills/*` into `~/.agents/skills/` (override the destination with `EGO_SKILLS_HOME`). Restart or re-index the agent so it picks up the new `SKILL.md` files.

Node.js is required for the `pinterest-download` CLI (`node` on `PATH`). The CLI is what you pass arguments to; it starts `ego-browser nodejs` for you. The embedded runtime does not receive shell argv.

First skill:

```bash
node skills/pinterest-download/scripts/download.mjs \
  --query wallpaper --count 2 --out "$HOME/Downloads/pinterest-ego"
```

If Pinterest is not signed in inside Ego Lite, the command exits `2` and prints how to log in once. It does not type your password. See [skills/pinterest-download/references/login.md](./skills/pinterest-download/references/login.md).

### Skills

| Skill | State | What it does |
|-------|--------|----------------|
| [`pinterest-download`](./skills/pinterest-download/) | shipping | Search pins by query and download N images with the Ego session. Parity intent with [`@sunkimkk/pinterest-mcp`](https://github.com/sunkimk/pinterest-mcp) search + download. |
| [`web-screenshot`](./skills/web-screenshot/) | stub | Capture full-page / element screenshots. |
| [`logged-in-scrape-pattern`](./skills/logged-in-scrape-pattern/) | stub | Canonical reuse-session → extract pattern. |

### Why ego

Agents inject scripts into **your** Ego profile. Sites you already use do not present a fresh login wall the way a cloud browser does. Skills are markdown plus a small `.mjs` file: `SKILL.md`, `agents/openai.yaml`, `scripts/`, `references/`.

This repo is for GitHub stars and agent reuse. No SaaS, no npm publish, no paid tier. Roadmap and non-goals: [PLAN.md](./PLAN.md).

### License

[MIT](./LICENSE)

---

## 中文

### 安装

1. 安装 [ego lite](https://lite.ego.app/) 并完成首次引导，使 `ego-browser` 在 `PATH` 上。
2. 确认：`command -v ego-browser && ego-browser skill | head`。
3. 克隆本仓库，把技能链接到 Agent 的 skills 目录：

```bash
git clone https://github.com/terryso/ego-skills.git
cd ego-skills
./scripts/install-skills.sh
```

脚本会把 `skills/*` 符号链接到 `~/.agents/skills/`（可用环境变量 `EGO_SKILLS_HOME` 改目标目录）。重启或重新索引 Agent，让它读到新的 `SKILL.md`。

`pinterest-download` 的命令行需要本机有 Node.js（`node` 在 `PATH` 上）。参数传给这个 CLI；它再去启动 `ego-browser nodejs`。内嵌运行时收不到 shell 的额外参数。

第一个可用技能：

```bash
node skills/pinterest-download/scripts/download.mjs \
  --query wallpaper --count 2 --out "$HOME/Downloads/pinterest-ego"
```

如果 Ego Lite 里还没登录 Pinterest，命令以退出码 `2` 结束，并打印一次性登录步骤，不会替你输入密码。说明见 [skills/pinterest-download/references/login.md](./skills/pinterest-download/references/login.md)。

### 技能

| 技能 | 状态 | 做什么 |
|-------|--------|--------|
| [`pinterest-download`](./skills/pinterest-download/) | 可用 | 按关键词搜索 Pin，并下载 N 张图片，走 Ego 里的登录态。对齐 [`@sunkimkk/pinterest-mcp`](https://github.com/sunkimk/pinterest-mcp) 的搜索 + 下载。 |
| [`web-screenshot`](./skills/web-screenshot/) | 骨架 | 整页 / 元素截图。 |
| [`logged-in-scrape-pattern`](./skills/logged-in-scrape-pattern/) | 骨架 | 复用登录态再抽取内容的写法模板。 |

### 为什么用 ego

脚本打进**你自己的** Ego 配置档。你平时在用的网站不会像云端浏览器那样再挡一层登录。每个技能就是 markdown 加一个小 `.mjs`：`SKILL.md`、`agents/openai.yaml`、`scripts/`、`references/`。

这个仓库只为 Star 和给 Agent 复用。没有 SaaS，不上架 npm，没有付费档。路线图和非目标见 [PLAN.md](./PLAN.md)。

### 许可证

[MIT](./LICENSE)
