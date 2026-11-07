# Adapter contract

The export script does not call this adapter. A host may. Unit tests use JSON fixtures only.

## Sanctioned runtime

Grok Bot's authenticated X connector:

| Tool | Role |
|------|------|
| `get_users_bookmarks` | Read one page. Required input includes the owner `id`. |
| `delete_users_bookmark` | Not used by this skill. Review may print the shape later. It does not delete the post. |

Do not call `api.x.com`. Do not read cookies, `auth_token`, `ct0`, or a browser profile. Do not use `ego-browser` as a substitute client. That backend is **unverified** and this repository does not implement it.

`check-deps` reports `connector_recipe_equals_ego_backend: false`. A recipe is not a completed Ego skill.

## Page file

The host saves the connector result and passes `--page`. Two shapes are accepted.

Normalized:

```json
{
  "account_id": "1000000000000000001",
  "next_token": null,
  "posts": []
}
```

`next_token` must be present. A missing key means the page end is unknown. The scan stays incomplete. `null` means the connector reported no further page. A non-empty string means continue. `""` is invalid.

X API v2 envelope:

```json
{
  "data": [],
  "includes": { "users": [], "tweets": [], "media": [] },
  "meta": { "next_token": "TOKEN", "result_count": 0 }
}
```

If `meta` exists and `next_token` is omitted, that is the end. If `meta` is missing, the end is unknown even when `data` is empty.

Put the same user id you passed as `get_users_bookmarks` `id` into `account_id` when you can. A different id is `account_mismatch` and nothing is ingested.

Suggested connector arguments, also printed by `export.mjs recipe`:

- `post.fields`: `id,text,created_at,author_id,note_tweet,entities,attachments,referenced_tweets,conversation_id`
- `expansions`: `author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id`
- `user.fields`: `id,name,username`
- `media.fields`: `media_key,type,alt_text`
- `max_results`: 1–100
- `pagination_token`: only when the archive status has `next_token`

Bookmark time is stored only from `bookmarked_at` or `bookmark_created_at`. `created_at` stays `post_created_at`. If the connector does not send a bookmark time, the archive records `bookmark_time_known: false`. It does not invent one.

Long text prefers `note_tweet.text`. A note object without text is `incomplete`. A quoted id with no included text is `incomplete`. Media keys without type metadata are `incomplete` and are not downloaded. A link without article text is `uncertain`.

## Bounded runs

`--max-pages` and `--max-items` stop before a page that would pass the cap. The previous token is kept. `complete` stays false and `incomplete_reason` is `bounded`. A full page of ids that were already archived still advances the token when a next token exists. That overlap is not a finished scan.

## What this contract does not prove

No live connector call, no Ego session, and no Pro bookmark read was made while this core was written. Fixtures are synthetic. Passing `npm test` does not mean Ego can read X bookmarks.
