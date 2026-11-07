# Ego Browser Skills — Open-Source Plan

> Working title: **ego-skills** (community skill pack for [ego lite](https://lite.ego.app/) / `ego-browser`)
> Status: public repo; **`pinterest-download`**, **`instagram-saved-download`**, **`wechat-channels-video`**, **`wechat-article-ego`**, **`kuaishou-video`**, **`youtube-video`**, **`douyin-video`**, **`teambition-ego`** (testcase reads plus Phase 2a single-case writes), and **`x-post`**. Requires ego lite / `ego-browser`. Each skill checks its own login. No separate cookie-healthcheck skill. Star-only, no commercial features.
> License target: **MIT**. Goal: **GitHub stars / agent adoption**, not commercialization.

---

## 1. Positioning

**One-liner:** Drop-in Agent Skills that teach Codex / Claude / Cursor agents to drive *real* Chromium via `ego-browser nodejs` — with the user's cookies and login sessions intact.

**Why this wins vs Puppeteer/Playwright MCP clouds:**
- Same browser profile the human already uses → no fresh-login dance for Pinterest, GitHub, Notion, etc.
- Agents inject scripts through the official CLI (`ego-browser nodejs`), not a second headless stack.
- Skills are markdown + small `.mjs` stubs: copy into `~/.agents/skills/` and go.
- Compatible with the shipping ego skill shape (`SKILL.md` frontmatter, `agents/openai.yaml`, `scripts/`, `references/`).

**Tagline candidates:**
- "Logged-in browser skills for AI agents"
- "ego-browser recipes that reuse your cookies"
- "Agent Skills that click like you already signed in"

---

## 2. Audience

| Who | Why they star / clone |
|-----|------------------------|
| **Codex / Claude Code / Cursor agents** (primary) | Need durable browser playbooks, not one-off chat scripts |
| Agent authors packaging skills | Want a MIT template that matches ego's layout |
| Indie hackers dogfooding ego lite | Need copy-paste patterns for scrape / screenshot / form fill |
| OSS maintainers | Want demo GIFs + one-liner install they can point issues at |

Non-audience (explicit): SaaS buyers, enterprise procurement, "managed browser cloud" users.

---

## 3. Why stars (not revenue)

- **Zero product surface** → low friction to try; stars = distribution for ego lite itself.
- Skills are the missing middle layer between "ego-browser skill guide" and "I need Pinterest download today."
- Viral loop: agent fails → finds this repo → GIF shows logged-in scrape in 20s → star + clone → more agents succeed → more issues/PRs → more stars.
- MIT + no telemetry + no signup = trust for agent authors who refuse SaaS wrappers.
- Showcase ego's differentiator (cookie/login reuse) better than marketing copy can.

Success metric v0: stars, clones, skill installs, demo GIF views, "works with ego-browser" mentions in other agent repos — **not** ARR.

---

## 4. Non-goals

- No SaaS, no hosted runners, no paid tiers, no API keys for *this* repo.
- No reimplementation of ego lite / Chromium.
- No Playwright/Puppeteer polyfill; stay on documented ego APIs (`taskSpace`, `page.*`, `page.evaluate`, `page.cdp`).
- No credential harvesting helpers; skills assume the user already logged in via ego GUI / `ego-browser import`.
- No ToS-breaking "bypass paywall / captcha farm" skills.
- No commercialization roadmap in this repo (sponsorships optional later; not the point).
- No GitHub org / company packaging yet — personal CascadeProjects first when ready.

---

## 5. First skill ideas (5–8)

| # | Skill id | Hook | Why it stars |
|---|----------|------|--------------|
| 1 | `pinterest-download` | Batch-save pin images while logged in (**shipping**) | Pain everyone hits; cookies matter |
| 2 | `instagram-saved-download` | Save your own Instagram Saved posts (**shipping**) | Login is the product; personal archive only |
| 2b | `wechat-channels-video` | Save a WeChat Channels video draft (**shipping**) | Login expires fast; publish stays human |
| 2c | `kuaishou-video` | Publish a local video on the Kuaishou creator platform (**shipping**) | Success is the under-review state |
| 2d | `youtube-video` | Publish a local video to YouTube Studio (**shipping**) | Private by default; success is a video URL plus processing status |
| 2e | `douyin-video` | Publish a local video to the Douyin creator center (**shipping**) | Public by default; success is content management or a publish-success message |
| 2f | `teambition-ego` | Read Teambition test plans and cases, and write one case at a time, through the Ego session (**shipping**, Phase 2a) | Login matters; the testcase API is not the Open API token |
| 2g | `x-post` | Post on X through the logged-in Ego session (**shipping**) | `page.fetch` CreateTweet; nothing sends without `--yes`; success is the status URL |
| 2h | `xiaohongshu-ego` | Publish one Xiaohongshu video note through the creator web UI (**shipping**) | Nothing uploads without `--yes`; `--cover` uses 选择图片上传 for the main cover; success is the explore URL |
| 2i | `wechat-article-ego` | Save one WeChat Official Account article draft through the visible editor (**shipping**) | Nothing uploads without `--yes`; `--yes` only clicks 保存; multiple visible accounts stop before the first save |
| 3 | `form-fill-demo` | Fill + submit a public demo form end-to-end | Not started |
| 4 | `github-starred-export` | Export the user's own starred repos | Not started |
| 5 | `notion-page-dump` | Export a logged-in Notion page to md/json | Not started |
| 6 | `qa-smoke-clickpath` | Recorded click path for webapp dogfooding | Not started |

**Shipped:** `pinterest-download`, `instagram-saved-download`, `wechat-channels-video`, `wechat-article-ego`, `kuaishou-video`, `youtube-video`, `douyin-video`, `teambition-ego` (testcase read plus Phase 2a single-case create / update / set-status / archive), `x-post`, and `xiaohongshu-ego`. Each needs ego lite and `ego-browser` on `PATH`. Each skill checks login itself. Do not add a separate `cookie-healthcheck` skill.

---

## 6. Packaging (ego-compatible)

Layout mirrors shipping ego skill + multi-skill repo conventions:

```
ego-skills/
  README.md                 # one-liner install + GIF gallery
  LICENSE                   # MIT
  PLAN.md                   # this file (may move to docs/ later)
  package.json              # name/version only; no runtime server
  docs/
    INSTALL.md              # symlink / clone into ~/.agents/skills
    CONTRIBUTING.md         # skill PR checklist
  assets/demos/             # README GIFs (star bait)
  skills/<skill-id>/
    SKILL.md                # YAML frontmatter + agent instructions
    agents/openai.yaml      # display_name / short_description / icons
    scripts/*.mjs           # runnable via: ego-browser nodejs < file.mjs
    references/*.md         # edge cases, selectors, ToS notes
  scripts/
    install-skills.sh       # one-liner: clone → link into ~/.agents/skills
    examples/               # tiny comments / expected invocation
```

**SKILL.md frontmatter convention** (match ego-browser):

```yaml
---
name: <skill-id>
description: <when to load; cookie/login reuse called out>
metadata:
  version: "0.1.0"
  requires:
    bins: [ego-browser]
  ego:
    min_skill_guide: "2.1.0"
---
```

**Runtime contract every skill must state:**
1. Prefer `ego-browser` over cloud browser MCPs when the task needs the user's session.
2. Before work: `command -v ego-browser` and (if needed) `ego-browser skill`.
3. Inject via `ego-browser nodejs` (heredoc / `-e` / `.mjs` file per shell rules).
4. Absolute paths for all file I/O; do not assume shell cwd or env.
5. Never clear cookies/cache without reading ego's clearing-state guidance.

Install story (star hook):

```bash
# one-liner (stub target)
curl -fsSL https://raw.githubusercontent.com/<you>/ego-skills/main/scripts/install-skills.sh | bash
# or: git clone … && ./scripts/install-skills.sh
```

Links each `skills/<id>` into `~/.agents/skills/<id>` (and notes Codex/Claude/Cursor skill discovery paths).

---

## 7. License

**MIT** everywhere (repo root `LICENSE` + per-skill notice optional). Dual-license or CLA: out of scope.

---

## 8. Star-growth hooks

1. **Demo GIF** — `assets/demos/pinterest-download.gif` when a logged-in run is recorded.
2. **One-liner install** — working `scripts/install-skills.sh` + README badge.
3. **"Works with ego lite"** badge + link to https://lite.ego.app/; reciprocal mention if ego ships a community skills list.
4. **Awesome-agents / skills directories** once `pinterest-download` is on `main`.
5. **Short "before/after"** in README: cloud MCP (login wall) vs ego-skills (already in).
6. **Issue templates**: "New site skill request" with domain + logged-in? checkbox.
7. **Keep skills tiny** — each SKILL.md ≤ ~80 lines + one example `.mjs`; agents actually load them.
8. **Login check stays inside each skill** — no separate cookie-healthcheck skill.

---

## 9. Near-term roadmap (skeleton → CascadeProjects → GitHub)

| Phase | Where | Deliverable |
|-------|-------|-------------|
| Now | `github.com/terryso/ego-skills` | `pinterest-download`, `instagram-saved-download`, `wechat-channels-video`, `wechat-article-ego`, `kuaishou-video`, `youtube-video`, `douyin-video`, `teambition-ego`, `x-post`, and `xiaohongshu-ego`. Bilingual README. Install script links `skills/*`. ego lite / `ego-browser` required. |
| Later | Community PRs | New skills only when they are actually useful. No SaaS language. |

The public repo is `https://github.com/terryso/ego-skills` (MIT). Do not add paid tiers, npm publish, or hosted runners.

---

## 10. Risks / ethics

- Site ToS: each skill `references/` must note "personal use / respect robots & ToS."
- Selective scraping only of content the logged-in user can already see.
- No captcha-solving, no credential stuffing, no sharing of exported session files in issues.
