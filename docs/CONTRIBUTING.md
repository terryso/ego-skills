# Contributing to ego-skills

中文要点见 [README_CN.md](../README_CN.md) 的「贡献」一节。完整规则以本文为准。

ego-skills is a **runnable Agent Skills monorepo for Ego Lite**. External pull requests are welcome. This is not an awesome-list of links, and it is not a central registry. The path in is: issue → scaffold → one-skill pull request → `npm test` → maintainer review of login behavior and terms of service.

Shipped skills today: `pinterest-download`, `instagram-saved-download`, `wechat-channels-video`, `kuaishou-video`, `youtube-video`, `douyin-video`, and `teambition-ego`. Each one needs [ego lite](https://lite.ego.app/) and `ego-browser` on `PATH`.

## What we accept

**ego-browser skills only.** The primary path talks to a real Chromium through documented `ego-browser` APIs (`ego-browser nodejs` or the wrappers already in this repo).

If the skill is a plain CLI, a pure MCP wrapper, or a cloud-browser automation that does not need Ego, we will not merge it. Publish that somewhere else:

- [terryso/claw-skills](https://github.com/terryso/claw-skills), or
- your own repository, installed with `npx skills add <owner/repo>`.

One skill (or one bugfix to one skill) per pull request. Docs-only pull requests are fine. A docs-only change does not need a new coverage target, and it must not claim a skill has shipped.

## Acceptance criteria

1. **Runtime.** `metadata.requires.bins` includes `ego-browser` (and usually `node`). Do not use Playwright, Puppeteer, or a cloud-browser MCP as the primary path.
2. **Login.** Missing `ego-browser`, or a logged-out site, is a soft-fail: exit `2` plus `how_to_login` / `how_to_login_zh`. Never type a password, never automate a QR scan, never paste or print cookies. Do not clear cookies unless the skill cites the product's own clearing steps and says so in `SKILL.md`.
3. **Tests.** Add `scripts/test/*.test.mjs`. `npm test` stays green. Line coverage for the c8 include set stays at or above **80%**. `skills/_template/` is a scaffold, not a shipped skill.
4. **Paths.** `SKILL.md`, scripts, references, and examples must not contain a contributor's machine path or a product directory. Use `/tmp/...` or `/absolute/path/to/video.mp4`.
5. **License.** The repo is MIT. The pull request template has a checkbox that you have the right to contribute under MIT. There is no DCO and no CLA. If you ported another project, say so in the PR (see `metadata.parity` / “Inspired by” on `pinterest-download`).
6. **Secrets.** No API keys, session files, cookie jars, or `.env` values.

## Layout

```text
skills/<id>/
  SKILL.md                 # name == directory name
  agents/openai.yaml
  scripts/check-login.mjs  # or download.mjs — soft-fail exit 2
  scripts/lib/pure.mjs     # testable decisions, no browser
  scripts/lib/ego-deps.mjs # ego-browser globals only; excluded from c8
  scripts/test/pure.test.mjs
  references/login.md
  references/tos-notes.md
```

`SKILL.md` frontmatter needs `name` (the directory name), `description`, `metadata.version`, `metadata.requires.bins`, and `metadata.ego.min_skill_guide`. Keep the body short (about 120–150 lines). Put long UI notes in `references/`.

Match a nearby skill when you grow past the scaffold: `wechat-channels-video` and `youtube-video` split login into `launch-check.mjs` / `run-check.mjs`. Download skills follow `pinterest-download`.

## Forbidden

- Playwright, Puppeteer, or a cloud-browser MCP as the primary path.
- Typing passwords, printing cookies, or committing session files or secrets.
- Personal or product absolute paths: a `/Users/` prefix, a `/home/<name>/` prefix, or a business/podcast directory.
- A downloader inside a publish skill (no yt-dlp, no gallery-dl, no fetching the video you are about to upload).
- Auto-clicking Publish / 发表 when that control needs a human QR scan.
- WeChat Channels: clicking 发表. Save a draft only.
- SaaS wrappers, paid tiers, credential harvesting, captcha farms, or a terms-of-service bypass.
- Drive-by edits to unrelated skills.
- Bumping the repo version in `package.json` or `.claude-plugin/plugin.json`. Maintainers bump on merge (new skill → minor, fix → patch). You do set that skill's own `metadata.version`.

## Video skills

Download skills and publish skills stay separate. Say which one you are in the issue and in `SKILL.md`.

Publish skills:

- The caller passes a **local absolute path** to the video. The skill does not download it and does not bake in a personal or product directory.
- Write the **success state** in `SKILL.md` before review. Use the observable result, for example: under review, a private video URL plus a processing status, content management or a publish-success message, or a saved draft.
- Do **not** auto-click a platform Publish control that waits on a human QR scan.
- **WeChat Channels is draft-only.** Stop at 保存草稿. Publishing stays with the human.

## Tests and coverage

`npm test` is c8 plus `node --test`. The script is a glob, not a hand-maintained list:

```json
"test": "c8 node --test skills/*/scripts/test/*.test.mjs scripts/test/*.test.mjs"
```

c8 includes every `skills/*/scripts/lib/**/*.mjs` except `ego-deps.mjs`, with `"all": true` and a **lines ≥ 80%** gate. A new lib file is picked up on its own. You do not edit an allow-list.

Put testable logic in `scripts/lib/` other than `ego-deps.mjs`. `ego-deps.mjs` is the runtime boundary (`taskSpace` and the other globals that exist only inside `ego-browser nodejs`). It is excluded from c8 on purpose. Entry files such as `check-login.mjs` are also outside the include set; drive them from lib helpers or spawn them in `scripts/test/`.

`skills/_template/` matches the same globs. Its tests must keep passing. It is not a skill you ship.

A docs-only pull request still runs `npm test`. It does not add a skill, so it does not take on a new coverage target.

## Issue → scaffold → pull request

1. Open a [skill request](../.github/ISSUE_TEMPLATE/skill-request.yml) (or a bug report). Cover the site, whether login is required, download vs publish vs draft-only, the success state, and a terms-of-service self-check. A large skill should wait for a maintainer reply before you write a lot of code.
2. A maintainer marks it accepted, duplicate, or out of scope. Out of scope (not ego-browser) points at claw-skills or `npx skills add`.
3. Scaffold (do this from the repo root):

   ```bash
   npm run new-skill -- <id>
   # same thing:
   node scripts/new-skill.mjs <id>
   ```

   `<id>` is lowercase letters, digits, and single hyphens, starting with a letter (`my-site-download`). The command copies `skills/_template/` to `skills/<id>/` and replaces `__SKILL_ID__`. It will not overwrite an existing directory. Names that start with `_` are reserved for scaffolds. `scripts/install-skills.sh` does not link those directories. Shipped skills still link as before.

4. Replace every TEMPLATE note, the `example.com` login URL, and the success-state section. Implement the skill. Keep examples on `/tmp/...` or `/absolute/path/to/video.mp4`.
5. Run `npm test`.
6. Open one pull request. Update `README.md`, `README_CN.md`, and the marketplace / plugin blurbs when the user-visible skill list changes. You can update the `package.json` description. Leave the version number to the maintainer.
7. Review, then merge. A maintainer may add an `ACCEPTANCE.md` line and a demo GIF under `assets/demos/`. If you have no GIF, say why in the PR and give the local command you ran.

## Ego smoke

A real Ego login smoke is **not** required to merge. CI has no logged-in browser, and this phase does not add one.

Please run `check-login` and the main path on your own Ego when you can, and paste the commands plus the result in the PR. If you cannot, say so. Maintainers may add the `needs-ego-smoke` label and try it before or after merge. The label is encouragement and review bookkeeping, not a required check.

## Pull request checklist

GitHub loads [.github/PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md). The short version: type of change, ego-browser only, no personal paths, login soft-fail, video success state, `npm test` / c8, bilingual README when the skill list changes, MIT checkbox, optional Ego smoke.

## Phase 2 (not in the tree yet)

Still to do, on purpose:

- `.github/workflows/ci.yml` running `npm ci && npm test` on pull requests and `main`. Until that exists, run `npm test` locally.
- `scripts/check-skill-hygiene.mjs`: `name` matches the directory, `ego-browser` is in bins, deny personal-path and secret-shaped files, require `scripts/test/` for every skill except `skills/_template`. The denylist should scan skill trees, not this document (this document names the path prefixes contributors must avoid).
- CODEOWNERS and label automation (`skill-request`, `skill-pr`, `bug`, `docs`, `good first skill`, `needs-ego-smoke`, `blocked-tos`). Add those labels by hand for now. Issue forms do not set labels, so a missing label cannot block issue creation.
