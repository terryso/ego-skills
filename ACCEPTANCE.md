# Acceptance

`npm test` on 2026-11-04 (Node v22.23.4, c8). The test script and c8 include are globs (`skills/*/scripts/test/*.test.mjs`, `scripts/test/*.test.mjs`, `skills/*/scripts/lib/**/*.mjs`). `ego-deps.mjs` and entry files such as `tb.mjs` stay outside the include. Covered modules: `pure.mjs`, `run.mjs` / `run-check.mjs`, `launch.mjs` / `launch-check.mjs`, and `media-fetch.mjs` where that file exists, under `pinterest-download`, `instagram-saved-download`, and `wechat-channels-video`. `kuaishou-video` also covers `config-file.mjs` and `run-ego.mjs`. `youtube-video` also covers `config-file.mjs`, `run-ego.mjs`, `publish-flow.mjs`, and `studio-dom.mjs`. `douyin-video` also covers `config-file.mjs`, `run-ego.mjs`, `publish-flow.mjs`, and `douyin-dom.mjs`. `teambition-ego` covers `pure.mjs`, `launch-check.mjs`, `run-check.mjs`, `session.mjs`, `write.mjs`, and `domains/testcase.mjs`. `x-post` covers `pure.mjs`, `launch.mjs`, `run-check.mjs`, `session.mjs`, and `post-flow.mjs`. `skills/_template/scripts/lib/pure.mjs` is included and is 100% lines.

| Metric | Result |
|--------|--------|
| Tests | 304 passed |
| Line coverage | **98.38%** |
| Statement coverage | 98.38% |
| Threshold | lines ≥ 80% (`package.json` `c8.lines`) |
| `wechat-channels-video` lib lines | **98.02%** |
| `kuaishou-video` lib lines | **98.46%** |
| `youtube-video` lib lines | **99.2%** |
| `douyin-video` lib lines | **98.93%** |
| `teambition-ego` included lib lines | **100%** (`session.mjs`, `domains/testcase.mjs`, `write.mjs`, `pure.mjs`, `launch-check.mjs`, `run-check.mjs`) |
| `x-post` included lib lines | **95.93%** (`launch.mjs`, `run-check.mjs` 100%; `pure.mjs` 99.71%; `post-flow.mjs` 96.91%; `session.mjs` 90.2%; `transaction.mjs` 88.62%) |

Reproduce: `npm test`. The report is `coverage/coverage-summary.json` (not committed).

## Mini smoke (ego-browser 0.6.0.12)

Default login gate, `wallpaper`, count 2, out `/tmp/ego-skills-smoke/login-required`:

- Exit **2**
- `login_required: true`, `how_to_login` length 5, `login_tip` present
- No images

Anonymous search + preview, same keyword:

```bash
node skills/pinterest-download/scripts/download.mjs search \
  --query wallpaper --count 2 --previews 1 --allow-anonymous \
  --out /tmp/ego-skills-smoke/wallpaper
```

- Exit **0**
- `method: BaseSearchResource`, `anonymous: true`, `login_tip_zh` present
- 2 JPEGs: 81,934 bytes (675×1200), 396,067 bytes (1440×2550)
- 1 preview JPEG, 22,926 bytes, `image/jpeg`
- Files stayed in `/tmp`. Not committed.

Sign in once in Ego Lite at https://www.pinterest.com/login/ for numeric ids, related pins, and boards. The skill does not type the password.

## Parity checklist

| Item | Status |
|------|--------|
| Keyword search + originals download | yes |
| Related pins | yes |
| Board feed | yes |
| Model-facing previews | yes (smoke saved one thumbnail) |
| Video MP4 download | unit-tested (expMp4 first, then cmfv). Not re-smoked on a logged-in Pro Ego in this change. See below. |
| `--min-width` / `--min-height` | unit-tested. Both flags require both sides. Direct `--url` is not filtered. |
| Login soft-fail + how_to_login | yes |
| Agent must tell the user login improves results | yes (`login_tip` on both runs) |

Live related, board, and MP4 calls were not repeated on this Mini because the Ego profile is logged out. Those paths are covered by `scripts/test/run.test.mjs`.

## Video `fetch failed` and min resolution

Root cause, checked against the sample `f99117a3…` URLs:

- `fetchBytes` returned immediately for `.mp4` / `.m3u8` / `.cmfv` when Node `fetch` threw `fetch failed`, so the logged-in `page.fetch` fallback never ran. Image URLs did fall through. That matches the Pro error string.
- `v1.pinimg.com` was already allowed by `*.pinimg.com`. The host list was not the bug.
- `/videos/iht/720p/<id>.mp4` is access-denied (403 XML). The progressive file is `/videos/iht/expMp4/<id>_720w.mp4` (`video/mp4`, `ftypisom`, video and audio). The `_720w.cmfv` sibling is the video-only CMAF track. Download now tries expMp4 at 720/540/360/240, then cmfv at 720/540/360.
- After a transport failure the order is: Node `fetch`, HTTP/1.1 over IPv4, then `page.fetch` `saveAs`. A real HTTP 404/403 still moves on to the next URL.

On this machine Node `fetch` of the sample cmfv and the expMp4 URL succeeded (about 4.8MB and 5.0MB). The Pro `fetch failed` path is covered by unit tests, not by a logged-in Ego run.

`--min-width` and `--min-height` filter search, related, board, and pin saves before the file is written. Skips land in `skipped[]`. One flag checks that side. Both flags require both sides to be known and at least those sizes. `download --url` is not filtered.

Manual smoke for a logged-in Ego (Pro / Echo / NEE), then confirm the task space is gone:

```bash
node skills/pinterest-download/scripts/download.mjs search \
  --query "cat video" --media video --count 1 --min-width 480 \
  --out /tmp/pinterest-video-smoke

node skills/pinterest-download/scripts/download.mjs download \
  --url 'https://v1.pinimg.com/videos/iht/hls/f9/91/17/f99117a3c598ab87cd1233848fe90011_720w.cmfv' \
  --out /tmp/pinterest-video-url
```

Expect exit 0, a file under `--out`, `downloads[].kind` `video`, and `manifest.json`. The direct URL should prefer the expMp4 rendition.

## instagram-saved-download (ego-browser 0.6.0.12)

This Ego profile is not signed in to Instagram. Saved posts are not visible anonymously.

```bash
node skills/instagram-saved-download/scripts/download.mjs list \
  --count 1 --out /tmp/ego-skills-smoke/ig-saved
```

- Exit **2**
- `login_required: true`, `logged_in: false`, `how_to_login` length 5, `login_tip` present
- Signals: no password field on `/saved/all-posts/`, no inbox link, no `ds_user_id`. A Saved link alone is not treated as logged in.
- Only `manifest.json` in the output directory. No images or video committed.

Sign in once at https://www.instagram.com/accounts/login/ in Ego Lite, then re-run. The script does not type the password. Image and MP4 save paths are covered by `skills/instagram-saved-download/scripts/test/run.test.mjs`.

## Instagram CDN `fetch failed`

Pro acceptance (logged-in Ego) listed Saved posts and then failed every image with `error: "fetch failed"`, `downloads: []`, exit 1. `fetchBytes` used Node `fetch` only. A thrown `fetch failed` was returned as the download error, with no HTTP/1.1 retry and no `page.fetch`.

The skill now uses the same order as Pinterest media: Node `fetch`, HTTP/1.1 over IPv4 with a browser User-Agent, then the logged-in page `saveAs`. This was not re-run against a logged-in Instagram session here.

Manual smoke:

```bash
node skills/instagram-saved-download/scripts/download.mjs \
  --count 1 --out /tmp/ig-saved-smoke
```

Expect exit 0, at least one image, `downloads[].kind` `image`, and the Ego task space closed (`finish({ keep: [] })` unless `--keep`).

## wechat-channels-video

Login-check only in unit tests. Logged out or missing `ego-browser` exits 2 with `how_to_login`. Logged in exits 0 and still prints `login_tip`. The task space closes with `finish({ keep: [] })` unless `--keep` (that path calls `handOff()`). The skill saves a draft; it does not click Publish. No logged-in Channels smoke was run here.

```bash
node skills/wechat-channels-video/scripts/check-login.mjs
```

## kuaishou-video

Publish a caller-supplied local video to https://cp.kuaishou.com . No download step. Login-check first. Logged out or missing `ego-browser` exits 2 with `how_to_login` / `how_to_login_zh`. Logged in exits 0 and still prints `login_tip`. The task space closes with `finish({ keep: [] })` unless `--keep` (that path calls `handOff()`).

Publish success is `{ "ok": true, "status": "审核中" }`. Flow errors exit 1. A login wall inside `publish.js` / `comment.js` exits 2 after `handOff()`. No logged-in Kuaishou smoke was run here.

Included lib line coverage: `pure.mjs` 100%, `run-check.mjs` 100%, `config-file.mjs` 100%, `launch-check.mjs` 94.87%, `run-ego.mjs` 92.98%.

```bash
node skills/kuaishou-video/scripts/check-login.mjs
bash skills/kuaishou-video/scripts/publish.sh /absolute/path/to/video.mp4 "描述 #话题"
```

## youtube-video

Publish a caller-supplied local video to https://studio.youtube.com/ . No download step and no yt-dlp. Login-check first. Logged out or missing `ego-browser` exits 2 with `how_to_login` / `how_to_login_zh`. Logged in exits 0 and still prints `login_tip` (being signed in to YouTube inside Ego gives the best results). The task space closes with `finish({ keep: [] })` unless `--keep` (that path calls `handOff()`).

Publish success is a video id, a `https://youtu.be/...` URL, and a processing status (`Uploading`, `Upload complete`, `Processing`, `Checks complete`, `Saved`, or `Published`). Visibility defaults to `private`. Made for kids defaults to No. Flow errors exit 1. No public upload was run here.

Login-check on this machine (ego-browser 0.6.0.12) exited 0. Studio was already signed in (`platformChrome` and `loggedInCookie` true, page title `频道信息中心 - YouTube Studio`), and the task space closed. No upload was started.

Included lib line coverage: `pure.mjs` 100%, `studio-dom.mjs` 100%, `run-check.mjs` 100%, `config-file.mjs` 100%, `publish-flow.mjs` 99.67%, `launch-check.mjs` 94.87%, `run-ego.mjs` 92.98%.

```bash
node skills/youtube-video/scripts/check-login.mjs
bash skills/youtube-video/scripts/publish.sh /absolute/path/to/video.mp4 "Title" "Description"
```

## douyin-video

Publish a caller-supplied local video to https://creator.douyin.com . No download step and no yt-dlp. Login-check first. Logged out or missing `ego-browser` exits 2 with `how_to_login` / `how_to_login_zh`. Logged in exits 0 and still prints `login_tip` (being signed in to Douyin inside Ego works better). check-login closes with `finish({ keep: [] })` unless `--keep` (that path calls `handOff()`).

Publish success is `{ "ok": true, "manageUrl": "https://creator.douyin.com/creator-micro/content/manage" }` when the URL contains `content/manage` or the page says 发布成功. The title is a separate field of at most 30 Unicode code points. The description is required. Defaults stay public, allow save, and publish immediately. A login wall inside `publish.js` calls `handOff()` and leaves the space open. A location-permission interrupt does the same, so the same `spaceId` can resume without uploading again. Other failures and a successful publish close the space unless keep is `1`. Comments are not scripted. Flow errors exit 1. No public upload was run here.

Login-check on this machine (ego-browser 0.6.0.12) exited 2. The upload page was a QR wall (`on_login_page`, `has_qr_hint`, title `抖音创作者中心`, `uploadChrome` false). `how_to_login` length 5 and `login_tip` were present. The task space closed (no `--keep`). No upload was started.

Included lib line coverage: `pure.mjs` 100%, `douyin-dom.mjs` 100%, `run-check.mjs` 100%, `config-file.mjs` 100%, `publish-flow.mjs` 100%, `launch-check.mjs` 94.87%, `run-ego.mjs` 92.98%.

```bash
node skills/douyin-video/scripts/check-login.mjs
bash skills/douyin-video/scripts/publish.sh /absolute/path/to/video.mp4 "Title" "Description #topic"
```

## teambition-ego

Reads Teambition test plans and test cases, and Phase 2a writes one case at a time (`create`, `update`, `set-status`, `delete` as archive with `--yes`). No download step. Login-check first. Logged out or missing `ego-browser` exits 2 with `how_to_login` / `how_to_login_zh`. Logged in exits 0 and still prints `login_tip` (sign in to teambition.com inside Ego before reading or changing cases). check-login closes with `finish({ keep: [] })` unless `--keep` (that path calls `handOff()`).

Reads and Phase 2a writes use `page.fetch` against `https://www.teambition.com`. Archive is `POST /api/testcases/{id}/archive`, not under `/testcase/api/`. They do not use `teambition_cli` or an Open API token. `plan`, `groups`, `cases`, `get`, `flow-statuses`, and the write commands leave the `tb-testcase api` space open for reuse. `cleanup` closes it with `finish({ keep: [] })`. `parse-url` does not open a browser. Unit tests mock the session and do not call Teambition.

Login-check on this machine (ego-browser 0.6.0.12) exited 2. The tab stayed on the public homepage (`https://www.teambition.com/`, title `钉钉 Teambition · 阿里巴巴旗下团队协作工具`). `platformChrome` and `loggedInCookie` were false, so this was not treated as the signed-in app. `how_to_login` length 5 and `login_tip` were present. The task space closed (no `--keep`). No testcase read was started.

Included line coverage under the c8 glob (everything in `scripts/lib/` except `ego-deps.mjs`): `session.mjs` 100%, `domains/testcase.mjs` 100%, `write.mjs` 100%, `run-check.mjs` 100%, `pure.mjs` 100%, `launch-check.mjs` 100%. `tb.mjs` and `ego-deps.mjs` stay outside the include, same as the other skills' entry files and `ego-deps.mjs`.

```bash
node skills/teambition-ego/scripts/check-login.mjs
node skills/teambition-ego/scripts/tb.mjs testcase parse-url "https://www.teambition.com/project/PROJECT/testplan/PLAN/group/GROUP"
```

## x-post

Posts to X through the logged-in Ego session. Login-check first. Logged out or missing `ego-browser` exits 2 with `how_to_login` / `how_to_login_zh`. Logged in exits 0 and still prints `login_tip`. check-login closes with `finish({ keep: [] })` unless `--keep` (that path calls `handOff()`).

`post.mjs` without `--yes` prints the draft and exits 3. It does not call X. `post.mjs --yes` sends `page.fetch` CreateTweet when the weighted length is at most 280, and CreateNoteTweet when it is over 280 or `--long` is set. Success is `https://x.com/<screen_name>/status/<id>`. Short posts read `data.create_tweet…rest_id`. Notes read `data.notetweet_create…rest_id` and the full body from `note_tweet.note_tweet_results.result.text`. Query ids are read from the loaded `main.*.js`. Fallbacks captured on 2026-11-04: CreateTweet `l4hk8uVGvR-a8kzQ4nOhPA`, CreateNoteTweet `seOZkIS8AysCGfPo6yYPVA`. CreateNoteTweet sends `x-client-transaction-id` derived from the live page; without it the capture returned GraphQL 226. `--reply-to` is best-effort. `cleanup` only closes the `x-post` task space. It does not call DeleteTweet.

Unit tests mock the session and do not call x.com. No Ego smoke was run in this environment (no logged-in browser). Pro smoke: show the exact text in `skills/x-post/SKILL.md`, then re-run that command with `--yes`. Leave the announcement up.

Included line coverage under the c8 glob: `launch.mjs` and `run-check.mjs` are 100% lines. `pure.mjs` is 99.71%. `post-flow.mjs` is 96.91%. `session.mjs` is 90.2%. `transaction.mjs` is 88.62%. CreateNoteTweet builds `x-client-transaction-id` for that POST path from the shell (verification key, a tight cluster of ondemand `[n], 16` indices, and `loading-x-anim`). A header copied from a different GraphQL call is not sent: Pro accept2 did that and X returned 226. The CreateNoteTweet query id is taken from `main.*.js` already loaded on the page. Long posts open `https://x.com/compose/post` and wait two seconds before `page.fetch`. `ego-deps.mjs` and the entry scripts stay outside the include.

```bash
node skills/x-post/scripts/check-login.mjs
node skills/x-post/scripts/post.mjs --text "ego-skills x-post: post on X from a logged-in Ego Lite session (page.fetch CreateTweet). Login-check first. Nothing sends without --yes. https://github.com/terryso/ego-skills"
```
