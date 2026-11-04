# ego-skills

Community **Agent Skills** for [ego lite](https://lite.ego.app/) / `ego-browser`.

Teach Codex, Claude, Cursor, and OpenClaw to automate a **real Chromium** that already has your cookies — via `ego-browser nodejs`.

[Chinese](README_CN.md)

> **Status:** [`pinterest-download`](./skills/pinterest-download/), [`instagram-saved-download`](./skills/instagram-saved-download/), [`wechat-channels-video`](./skills/wechat-channels-video/), [`kuaishou-video`](./skills/kuaishou-video/), [`youtube-video`](./skills/youtube-video/), and [`douyin-video`](./skills/douyin-video/). Requires [ego lite](https://lite.ego.app/) and `ego-browser` on `PATH`. Plan: [PLAN.md](./PLAN.md). Star-only OSS, [MIT](./LICENSE). Not published to npm.

## Installation

Four real options. The Claude marketplace and `npx skills` both read the GitHub **default branch** (`main`). Until a change is merged, install from a clone (options 3 and 4).

### Option 1: Claude Code plugin marketplace

Uses `.claude-plugin/marketplace.json` and `plugin.json` (same layout as [terryso/claw-skills](https://github.com/terryso/claw-skills)). Claude Code loads `skills/*/SKILL.md`.

```text
/plugin marketplace add terryso/ego-skills
/plugin install ego-skills
```

### Option 2: npx skills

The [`skills`](https://github.com/vercel-labs/skills) CLI (Node.js 22.20+) discovers `skills/*/SKILL.md` and installs into the agents it finds, including Claude Code, Codex, Cursor, and OpenClaw. This repo does not publish an npm package.

```bash
npx skills add terryso/ego-skills
# one skill, one agent:
npx skills add terryso/ego-skills --skill pinterest-download -a claude-code
```

### Option 3: Git submodule

```bash
git submodule add https://github.com/terryso/ego-skills.git .agents/ego-skills
./.agents/ego-skills/scripts/install-skills.sh
```

### Option 4: Clone and copy / symlink

```bash
git clone https://github.com/terryso/ego-skills.git
cd ego-skills
./scripts/install-skills.sh            # ~/.agents/skills  (Codex and the shared path)
./scripts/install-skills.sh --agent claude     # ~/.claude/skills
./scripts/install-skills.sh --agent cursor     # ~/.cursor/skills
./scripts/install-skills.sh --agent openclaw   # ~/.openclaw/skills
./scripts/install-skills.sh --all
```

Those directories are the global paths from the public skills CLI. `EGO_SKILLS_HOME` overrides the default destination when you do not pass `--agent`.

`ego-browser` must be on `PATH` (`command -v ego-browser`). Day-to-day browser work still follows `ego-browser skill`.

## Skills

| Skill | What it does |
|-------|----------------|
| [`pinterest-download`](./skills/pinterest-download/) | Search, related pins, board feed, model thumbnails, image and MP4 download through the Ego session. Optional `--min-width` / `--min-height`. |
| [`instagram-saved-download`](./skills/instagram-saved-download/) | Download your own Instagram Saved posts. Each skill checks its own login. |
| [`wechat-channels-video`](./skills/wechat-channels-video/) | Save a WeChat Channels video draft. Login-check first. Does not click Publish. |
| [`kuaishou-video`](./skills/kuaishou-video/) | Publish a local video to the Kuaishou creator platform. Login-check first. Success means the work shows as under review. |
| [`youtube-video`](./skills/youtube-video/) | Publish a local video to YouTube Studio. Login-check first. Default visibility is private and Made for kids is No. Success is a video URL plus a processing status. |
| [`douyin-video`](./skills/douyin-video/) | Publish a local video to the Douyin creator center. Login-check first. Title is at most 30 characters. Defaults stay public, allow save, and publish immediately. Success is content management or a publish-success message. |

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
node skills/kuaishou-video/scripts/check-login.mjs
bash skills/kuaishou-video/scripts/publish.sh /absolute/path/to/video.mp4 "A short description #topic"
```

```bash
node skills/youtube-video/scripts/check-login.mjs
bash skills/youtube-video/scripts/publish.sh /absolute/path/to/video.mp4 "Title" "Description"
```

```bash
node skills/douyin-video/scripts/check-login.mjs
bash skills/douyin-video/scripts/publish.sh /absolute/path/to/video.mp4 "Title" "Description #topic"
```

If the site is not signed in, the command exits `2` and prints how to log in once. It does not type a password. Tell the user that signing in inside Ego Lite is what makes the result work (Pinterest results improve; Instagram Saved is not visible anonymously; WeChat Channels sessions expire quickly; Kuaishou creator publish stops on the QR wall until someone scans it; YouTube uploads work best when that channel is already signed in inside Ego; Douyin creator publish works better when that account is already signed in inside Ego). See each skill's `references/login.md`.

## Why ego

Scripts run in **your** Ego profile. Sites you already use do not get a fresh login wall the way a cloud browser does. Each skill is markdown plus a small script: `SKILL.md`, `agents/openai.yaml`, `scripts/`, `references/`.

This repo is for GitHub stars and agent reuse. No SaaS, no paid tier. Roadmap: [PLAN.md](./PLAN.md). Tests: `npm test` (coverage in [ACCEPTANCE.md](./ACCEPTANCE.md)).

## License

[MIT](./LICENSE)
