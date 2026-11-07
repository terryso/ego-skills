# X bookmark workflow — acceptance notes

## Standalone Ego bookmark backend: unsupported

A Pro read-only runtime smoke does **not** make an Ego bookmark backend. The connector skills are not equivalent to one. X access stays on the Grok Bot connector (`get_users_bookmarks` / `delete_users_bookmark`). No private X endpoints. No browser session against X. No real cleanup. Do not publish.

Pro smoke recorded 2026-11-07. Do not upgrade the app from this note.

| Check | Result |
|-------|--------|
| Binary | `/Users/nick/.local/bin/ego-browser`, effective v0.6.2.8 |
| App plist | 0.6.2.9. Leave it. Do not upgrade. |
| Skill guide | v2.2.0 |
| Host Node | v26.12.1. `taskSpace` and `listTaskSpaces` are undefined. |
| `ego-browser nodejs` | Those two globals are present only in that runtime. |
| Fixture task | Create, evaluate, then `finish({ keep: [] })`. Zero task spaces left. |
| Pro `main` | `4ebbaf5`. Nine skills. No bookmark implementation. |
| `learnings/x-com` | Timeline, search-users, and post scripts only. None executed. No proven bookmark read or remove. |
| `skills/bilibili-video/` | Untracked on that machine. This branch does not touch it. |

This branch is **not** a completed Ego skill. Unit tests cover the portable core. They do not prove a live X account.

| Fact | Value |
|------|--------|
| Branch | `cursor/x-bookmark-workflow-3736` |
| Base | `main` |
| Standalone Ego bookmark backend | `unsupported` |
| Connector recipe equals an Ego backend | no |
| Pro runtime smoke proves bookmarks | no |
| Live X read or unbookmark in the coding run | no |
| Publish to SkillHub / ClawHub | do not |

Check out this branch's PR head. Do not use `main` for these commands. Do not merge the PR from this document.

## What was implemented

- `skills/x-bookmark-export` archives connector page files. It writes JSON and Markdown, keeps post time and bookmark time apart, and records an incomplete scan when a next token remains.
- `skills/x-bookmark-review` accepts structured analysis, renders at most three suggestions, and plans unbookmark allowlists. Default apply is a dry run (exit 3).
- `templates/x-bookmark-keeper/` is generic bot text. It does not create a bot.

The Grok Bot X connector is the sanctioned runtime route: `get_users_bookmarks` to read, `delete_users_bookmark` only after a signed plan. This repo does not call either tool.

Ego-backed X automation was not implemented. Inventing a browser or private-API client would violate the X constraints. A Pro machine having `ego-browser` does not turn this core into a live-proven skill.

## Offline commands

From a clean checkout of this branch, with no X credentials and no private bookmark file:

```bash
npm ci
npm run hygiene
npm test
node skills/x-bookmark-export/scripts/check-deps.mjs
node skills/x-bookmark-review/scripts/check-deps.mjs
```

Expect `ego_backend` = `unverified`, `ego_browser_invoked` = false, `live_proven_ego_skill` = false, `connector_recipe_equals_ego_backend` = false. Expect `--require-ego` and `--require-connector` to exit `2`.

Fixture path, still with no network:

```bash
mkdir -p /tmp/x-bookmark-offline
cat > /tmp/x-bookmark-page.json <<'JSON'
{
  "account_id": "1000000000000000001",
  "next_token": "synthetic-next",
  "posts": [{
    "id": "2000000000000000001",
    "text": "synthetic fixture",
    "created_at": "2026-01-01T00:00:00.000Z",
    "bookmarked_at": "2026-04-04T00:00:00.000Z",
    "author": {"id": "3000000000000000001", "username": "example_author", "name": "Example"}
  }]
}
JSON
node skills/x-bookmark-export/scripts/export.mjs ingest \
  --account 1000000000000000001 \
  --archive /tmp/x-bookmark-offline \
  --page /tmp/x-bookmark-page.json
node skills/x-bookmark-export/scripts/export.mjs render \
  --account 1000000000000000001 \
  --archive /tmp/x-bookmark-offline
node skills/x-bookmark-review/scripts/review.mjs onboard \
  --answers /tmp/x-bookmark-answers.json
```

`ingest` must report `complete: false` and `incomplete_reason: has_next_token`. Rendered Markdown must show both timestamps and must not contain `synthetic-next`. Create `/tmp/x-bookmark-answers.json` as `{}` first. Onboard must print only the X-connection question.

Write a synthetic analysis only if you need to see a preview. `apply` without `--yes` must exit `3` and print `issue: false`. Do not pass `--yes` against anything except a throwaway fixture archive. Even then, do not execute `connector_ops` unless a later, separate approval says so. This coding run did not.

Confirm the process list for these commands does not include `ego-browser`. If `ego-browser` is on `PATH`, that is incidental. These scripts must not spawn it.

## Pro / Mini later

Use the same commands on the Pro or Mini checkout of this branch. That is an offline smoke of the core, not an Ego login smoke and not a live bookmark read.

Do not:

- feed a private bookmark export from another box
- call `get_users_bookmarks` or `delete_users_bookmark` as part of accepting this PR
- open x.com in Ego and treat that as this skill working
- install cron or a watchdog
- publish the skills

A parent who later investigates whether any supported Ego API can see bookmarks should do that on a separate change. This branch leaves that backend unimplemented on purpose.

## Coverage

`npm test` on 2026-11-07 (Node v22.23.4): **427 passed**, c8 lines **97.76%** (gate 80%). `x-bookmark-export` lib lines 98.77%. `x-bookmark-review` lib lines 93.59%. Report path: `coverage/coverage-summary.json` (not committed).

That run did not start Ego and did not call X. The historical table in `ACCEPTANCE.md` is an older snapshot of other skills.
