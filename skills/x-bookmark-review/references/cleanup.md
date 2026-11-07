# Cleanup

Analysis files never remove bookmarks. `plan` writes a signed allowlist and local `cleanup_planned` rows. `connector_ops` stays empty.

`apply` without `--yes` exits `3` and still returns no connector operations.

`apply --yes` rechecks the plan MAC, account, expiry (24 hours), cap, consent, archive hash, and delivery receipt. It then writes `remove_dispatched` before it returns `delete_users_bookmark` arguments. The script does not perform that call.

The host may call the Grok Bot X connector `delete_users_bookmark` with `id` = account and `tweet_id` = the allowlisted post. Then `commit-removal` records the connector result. A result for an id that was not dispatched is rejected. `removed: "true"` as a string does not count.

If the connector removed a bookmark and the local commit did not land, the row stays dispatched and unacked. The next `apply` will not send that id again. `reconcile` with a presence file is the retry gate:

- `present: false` records `cleanup_succeeded` without another remove call.
- `present: true` and fewer than 2 attempts allows one later `apply`.
- `present: true` after 2 attempts stays `cleanup_failed`.
- Missing or non-boolean presence stays unresolved and does not remove.

Unhelpful rows need `discard_unhelpful: true`, a stored reason, complete content, and the archived post. Incomplete or uncertain content is blocked even when that flag is true.

Actionable rows need `cleanup_processed: true`, `notified: true`, and a receipt whose HMAC matches the rendered suggestion body. A boolean on the analysis file is not a receipt. Expired or edited receipts are blocked.

There is no delete-everything command. `--all` is rejected. Archive post files stay on disk. Unbookmark does not delete the original post. Bookmarking it again may not restore order or folder.

No live removal was run in this change. Tests use an in-process fake adapter and JSON result files.
