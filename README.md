# ego-skills

Community **Agent Skills** for [ego lite](https://lite.ego.app/) / `ego-browser`.

Teach Codex, Claude, Cursor, and OpenClaw to automate a **real Chromium** that already has your cookies — via `ego-browser nodejs`.

[Chinese](README_CN.md)

> **Status:** [`pinterest-download`](./skills/pinterest-download/), [`instagram-saved-download`](./skills/instagram-saved-download/), [`wechat-channels-video`](./skills/wechat-channels-video/), [`kuaishou-video`](./skills/kuaishou-video/), [`youtube-video`](./skills/youtube-video/), [`douyin-video`](./skills/douyin-video/), [`teambition-ego`](./skills/teambition-ego/), [`x-post`](./skills/x-post/), and [`xiaohongshu-ego`](./skills/xiaohongshu-ego/). Requires [ego lite](https://lite.ego.app/) and `ego-browser` on `PATH`. Plan: [PLAN.md](./PLAN.md). Star-only OSS, [MIT](./LICENSE). Not published to npm.

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
| [`teambition-ego`](./skills/teambition-ego/) | Read Teambition test plans and test cases through the Ego session. Login-check first. Phase 2a also creates, updates, sets status, and archives one case (`delete --yes`). Browser session only, not an Open API token. |
| [`x-post`](./skills/x-post/) | Post on X from the logged-in Ego session with `page.fetch` CreateTweet. Login-check first. Nothing is sent without `--yes`. Optional `--image` (up to 4 png/jpeg/webp, each ≤ 5 MiB) uploads only with `--yes`. Success is `https://x.com/<screen_name>/status/<id>`. |
| [`xiaohongshu-ego`](./skills/xiaohongshu-ego/) | Publish one Xiaohongshu video note on the creator site. Login-check first. Nothing uploads without `--yes`. Notes must not contain links: remove them from the copy or pass `--strip-links`. Pass `--cover` (for example `cover-3x4.png`) through 选择图片上传 so it becomes the main cover. PK slots alone leave the thumbnail as the first frame for about 72 hours. Without `--cover` the platform keeps the first frame. Success is `https://www.xiaohongshu.com/explore/<noteId>`. |

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

```bash
node skills/teambition-ego/scripts/check-login.mjs
node skills/teambition-ego/scripts/tb.mjs testcase parse-url "https://www.teambition.com/project/PROJECT/testplan/PLAN/group/GROUP"
```

```bash
node skills/x-post/scripts/check-login.mjs
node skills/x-post/scripts/post.mjs --text "Draft only until you pass --yes"
node skills/x-post/scripts/post.mjs --text "Draft only until you pass --yes" --image /absolute/path/to/image.png
```

```bash
node skills/xiaohongshu-ego/scripts/check-login.mjs
node skills/xiaohongshu-ego/scripts/post-video.mjs \
  --video /absolute/path/to/video.mp4 --title "Title" --desc "Description" \
  --cover /absolute/path/to/cover-3x4.png
```

If the site is not signed in, the command exits `2` and prints how to log in once. It does not type a password. Tell the user that signing in inside Ego Lite is what makes the result work (Pinterest results improve; Instagram Saved is not visible anonymously; WeChat Channels sessions expire quickly; Kuaishou creator publish stops on the QR wall until someone scans it; YouTube uploads work best when that channel is already signed in inside Ego; Douyin creator publish works better when that account is already signed in inside Ego; Teambition test plans are readable and single cases can be updated after signing in to teambition.com inside Ego; X posts send only after x.com is signed in inside Ego and the draft is confirmed with `--yes`; Xiaohongshu posts one video note only after creator.xiaohongshu.com is signed in and the plan is confirmed with `--yes`, and a passed `--cover` must change the main cover through 选择图片上传 before 发布). See each skill's `references/login.md`.

## Why ego

Scripts run in **your** Ego profile. Sites you already use do not get a fresh login wall the way a cloud browser does. Each skill is markdown plus a small script: `SKILL.md`, `agents/openai.yaml`, `scripts/`, `references/`.

This repo is for GitHub stars and agent reuse. No SaaS, no paid tier. Roadmap: [PLAN.md](./PLAN.md). Tests: `npm test` (coverage in [ACCEPTANCE.md](./ACCEPTANCE.md)).

## Contributing

External pull requests are welcome for **runnable ego-browser skills**. A CLI or MCP wrapper that does not use `ego-browser` belongs in [claw-skills](https://github.com/terryso/claw-skills) or your own repo (`npx skills add`).

The guide is [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md). Short version:

- Open a skill-request issue, then `npm run new-skill -- <id>` (copies `skills/_template/`).
- One skill per PR. Frontmatter bins include `ego-browser`. Login soft-fails with exit `2`. No passwords, no personal absolute paths, no Playwright as the primary path.
- Video publish skills name the success state in `SKILL.md`. The caller supplies the local file. Do not auto-click a Publish control that needs a human QR scan. WeChat Channels stays draft-only.
- MIT (checkbox on the PR; no DCO or CLA). `npm test` must pass (c8 lines ≥ 80%). A local Ego smoke is encouraged and is not required to merge; maintainers may add the `needs-ego-smoke` label.

## License

[MIT](./LICENSE)
