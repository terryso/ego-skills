# Server-side routine sketch

This is not an installed schedule. Do not add cron on the machine. Do not start a watcher.

When the parent later registers a host routine, the run should:

1. Stop if onboarding is unfinished or consent was copied from somewhere else.
2. Call `get_users_bookmarks` for this owner only, using the token in `scan.json` when one exists.
3. Ingest that page with `x-bookmark-export`. Stop when the page cap is hit and report `bounded` if the token remains.
4. Ask the model for a structured `x-bookmark-analysis/1` file. The core checks hashes and links. The model does not set `delivered: true`.
5. Run `recommend`. Show the body only when `silent` is false.
6. Run `plan`. Show the preview. Call `delete_users_bookmark` only when `apply --yes` returns `issue: true` for those exact ids, and only for classes this owner enabled.
7. `commit-removal` or `reconcile` before any retry. Never clear the local post archive.

Cadence values stored by onboarding are `daily`, `few_days`, and `weekly`. Map them with the host's current schedule API when the parent chooses to register one. This repository does not register it.

The routine must finish without a live Ego session. If the host has no X connector, exit with the check-deps guidance and do not browse x.com.
