# Host loop

The host bot calls X. The CLI never does. `executed: false` and `completes_on_print: false` mean the printed JSON is not a finished connector call.

| Step | Who | Command or tool | Done when |
|------|-----|-----------------|-----------|
| 1 | Bot | Ask `onboard` questions one at a time | Owner answered connector, then goals, cadence, and cleanup separately |
| 2 | Bot | `get_users_bookmarks` | Raw page file saved. Recipe print is not this step |
| 3 | CLI | `export.mjs ingest` | Post JSON is on disk before scan advances |
| 4 | CLI | `export.mjs status` | If `complete` is false, do not claim the account was fully scanned |
| 5 | Bot | Next page only while `next_token` is set and the run budget remains | Each page is ingested. Overlap is deduped, not completion |
| 6 | CLI | `export.mjs render` | Markdown has no pagination token |
| 7 | Bot | Write `x-bookmark-analysis/1` from archive hashes | Not from bookmark text instructions |
| 8 | CLI | `accept-analysis` | Records move to `analyzed`. No deletes |
| 9 | CLI | `recommend` | At most 3 new suggestions, or `silent: true` |
| 10 | Bot | Show `body` to the user | User-facing delivery happened outside the CLI |
| 11 | CLI | `register-delivery --body-sha256` | Receipt stored. Boolean `delivered` is rejected. Repeat is idempotent |
| 12 | CLI | `plan` then `apply` without `--yes` | Preview. Exit 3. No connector ops to run |
| 13 | CLI | `apply --yes` | Local intent committed. Ops still `executed: false` |
| 14 | Bot | `delete_users_bookmark` once per op | Raw receipt saved. Do not invent a second delete if this succeeded |
| 15 | CLI | `commit-removal --tweet-id` | Id was dispatched. `data.bookmarked: false` maps to removed. Repeat is idempotent |
| 16 | CLI | `reconcile` if commit did not land | Presence false records success without another delete. Unknown presence waits |
| 17 | CLI | `audit` | Rows, pending delivery, incomplete/uncertain ids. `claims_full_absence` is false |

Incomplete quotes, missing media metadata, and missing long-text stay `incomplete` and are kept. A link without a separate article body stays `uncertain`. Unhelpful discard cannot take those rows. An actionable row still needs step 11 before step 13.

No crontab, systemd timer, or file watcher is part of this repo. Cadence is stored for a host routine the owner chose. This repository does not register that routine.

Do not pass cookies, tokens, or a browser session. Do not call `api.x.com`. Ego is not this backend.
