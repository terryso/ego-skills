# Getting started

Connector-first bookmark loop for a host bot. This file is the install and run contract. It does not create a bot, export a share link, or install cron.

This version is **not an Ego backend**. `check-deps` reports `standalone_ego_bookmark_backend: not_implemented` and `ego_bookmark_acceptance: not_accepted`. Printing a recipe does not call X. The host bot calls the authenticated X connector, then passes the raw result back to the CLI.

## Install both skills

From a checkout of branch `cursor/x-bookmark-workflow-3736` (do not use `main` until that branch is merged):

```bash
npm ci
npm test
./scripts/install-skills.sh --agent cursor
```

`--agent` may be `cursor`, `claude`, `openclaw`, or omitted for `~/.agents/skills`. Both `x-bookmark-export` and `x-bookmark-review` must sit side by side. Review exits 2 if export is missing.

Node on the host runs the CLI. Node cannot authenticate to X. Do not read cookies or tokens.

## Ask the owner, one question at a time

Start from `{}`. Do not copy another owner's name, goals, consent, archive path, or private links. There is no NEE identity in this template.

```bash
node skills/x-bookmark-review/scripts/review.mjs onboard --answers /tmp/x-bookmark-answers.json
```

Write only the answer to the printed `id`, then run the command again.

1. `x_connection` — connector authorization. Stop until the host shows the X connector is connected for this owner.
2. `goals`
3. `cadence` — `daily`, `few_days`, or `weekly`. This does not install cron or a watchdog. A repeating run, if any, is a host routine the owner asked for.
4. `cleanup_mode` — `preview` or `auto`. Cleanup is a separate question from the connector.
5. Only after `auto`: `auto_processed`, then `auto_unhelpful`. The string `"true"` does not opt in.

Persist with `--apply` only when `done` is true:

```bash
node skills/x-bookmark-review/scripts/review.mjs onboard \
  --apply --account ACCOUNT --archive /tmp/x-bookmark-archive \
  --answers /tmp/x-bookmark-answers.json
```

`preview` stores both cleanup flags false.

## One run

Replace `ACCOUNT` with the connector user id. Replace `PAGE` with the file the host just saved from `get_users_bookmarks`. Do not point `PAGE` at someone else's export.

```bash
node skills/x-bookmark-export/scripts/check-deps.mjs
node skills/x-bookmark-export/scripts/export.mjs recipe --account ACCOUNT
```

`recipe` prints arguments and `executed: false`. The host bot calls `get_users_bookmarks`, saves the raw JSON, then:

```bash
node skills/x-bookmark-export/scripts/export.mjs ingest \
  --account ACCOUNT --archive /tmp/x-bookmark-archive --page PAGE
node skills/x-bookmark-export/scripts/export.mjs status \
  --account ACCOUNT --archive /tmp/x-bookmark-archive
node skills/x-bookmark-export/scripts/export.mjs render \
  --account ACCOUNT --archive /tmp/x-bookmark-archive
```

If `complete` is false, the scan is not finished. A next token, a short page, or an overlapping page does not mean the account has no more bookmarks. Fetch the next page with `status.next_token` and ingest again, or stop and say the scan is partial.

Write `x-bookmark-analysis/1` only from the archive (hash and https source that appears on the archived post). Then:

```bash
node skills/x-bookmark-review/scripts/review.mjs accept-analysis \
  --account ACCOUNT --archive /tmp/x-bookmark-archive --analysis /tmp/x-bookmark-analysis.json
node skills/x-bookmark-review/scripts/review.mjs recommend \
  --account ACCOUNT --archive /tmp/x-bookmark-archive
```

`silent: true` means send nothing. Otherwise show `body` to the user. That show is not registered until:

```bash
node skills/x-bookmark-review/scripts/review.mjs register-delivery \
  --account ACCOUNT --archive /tmp/x-bookmark-archive \
  --recommendation RECOMMENDATION_ID --body-sha256 BODY_SHA256
```

Use the `body_sha256` from `recommend`. `--delivered true` is rejected. Repeat registration is idempotent. Without this step, cleanup cannot remove those bookmarks.

```bash
node skills/x-bookmark-review/scripts/review.mjs plan \
  --account ACCOUNT --archive /tmp/x-bookmark-archive
node skills/x-bookmark-review/scripts/review.mjs apply \
  --account ACCOUNT --archive /tmp/x-bookmark-archive --plan PLAN_ID
```

Apply without `--yes` exits 3 and does not authorize a connector call. With owner opt-in and `--yes`:

```bash
node skills/x-bookmark-review/scripts/review.mjs apply \
  --account ACCOUNT --archive /tmp/x-bookmark-archive --plan PLAN_ID --yes
```

For each object in `connector_ops`, the host bot calls `delete_users_bookmark` with those arguments. `executed: false` on the object means the CLI did not call it. Save each raw tool result. Then, one id at a time:

```bash
node skills/x-bookmark-review/scripts/review.mjs commit-removal \
  --account ACCOUNT --archive /tmp/x-bookmark-archive \
  --results /tmp/x-bookmark-receipt.json --tweet-id TWEET_ID
```

`TWEET_ID` must be the id `apply --yes` already dispatched. A connector body `{ "data": { "bookmarked": false } }` has no post id of its own. `bookmarked: true` is not success. Running commit again for the same success is idempotent. The archive file stays.

If the connector returned and commit did not land, do not call delete again. Read presence with `get_users_bookmarks` (or the next page) and:

```bash
node skills/x-bookmark-review/scripts/review.mjs reconcile \
  --account ACCOUNT --archive /tmp/x-bookmark-archive --presence /tmp/x-bookmark-presence.json
node skills/x-bookmark-review/scripts/review.mjs audit \
  --account ACCOUNT --archive /tmp/x-bookmark-archive
```

`audit.claims_full_absence` is always false. Incomplete and uncertain rows stay in the archive. Uncertain rows are not discarded as unhelpful.

Full host order: `skills/x-bookmark-review/references/host-loop.md`.
