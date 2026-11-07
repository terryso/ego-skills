# Archive layout

`--archive` must be an absolute path and must not be the filesystem root. Each account is `accounts/<id>/`, and `<id>` is a 1–20 digit string.

```text
/tmp/x-bookmark-archive/accounts/<id>/
  manifest.json
  key.json
  scan.json
  consent.json
  posts/<post id>.json
  records/<post id>.json
  exports/bookmarks.json
  exports/bookmarks.md
  lock.json
```

`key.json` is a local HMAC key for later review receipts. It is not an X credential. Do not commit an archive.

`posts/*.json` is the original normalized content and is written before `scan.json` advances. A crash can leave a post file without a record. The next ingest of the same page finishes the record and does not claim a new bookmark.

`records/*.json` keeps `status`, `read`, and `notified` separately. Export sets `status` to `fetched`, `read` false, and `notified` false. `mark-read` sets `read` true and leaves `notified` alone.

Scan `complete: true` happens only when the page end is known and the token is null. Markdown export repeats `scan_complete` and does not include the pagination token.

The lock is `lock.json`. A live holder is not stolen. A dead same-host pid can be replaced. Another host is replaced only after the TTL. Nested calls in one process reuse the held lock. A second process gets `lock_busy`.

Consent starts as preview: both cleanup flags false. This skill does not change that. Review owns opt-in.

Post text is stored as text. Cookie, token, and authorization fields on the raw page are not copied into the archive.
