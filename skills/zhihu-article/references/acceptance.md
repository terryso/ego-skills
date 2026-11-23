# Local acceptance (zhihu-article)

Unit tests do not open Zhihu and do not prove this plan. Do not treat a green `npm test` as a live pass.

Unit fixtures do not prove the live homepage. Browser layout, selectors, paste formatting, and image persistence stay **unverified** until a later owner run records them.

On commit `da7883c`, a logged-in Pro homepage correctly stopped listing feed authors, then exited `4` with `identity-not-visible`. The header avatar `alt` was `点击打开BMAD实验室的主页` with no spaces. That string was only parsed from `aria-label`, and a raw `alt` was rejected because it contained `点击打开`. The avatar `alt` is now parsed the same way, spaces optional. Re-run `check-login --json` on that homepage. A pass is exit `0`, `account` `BMAD实验室`, `identityVisible: true`, and no feed authors in `accounts`. `--expect-account` must use that same name. This fixture does not replace that re-run. If the avatar is outside `header` / `banner` / `AppHeader`, the result stays `identity-not-visible`.

## Before any draft write

Run these with no `--save-draft`. They must not create or change a draft.

```bash
node skills/zhihu-article/scripts/preview.mjs \
  --markdown /absolute/path/to/article.md \
  --cover /absolute/path/to/cover.png \
  --json

node skills/zhihu-article/scripts/check-login.mjs --expect-account "示例作者" --json
```

Confirm:

- preview exits `0`, `state` is `not-started`, and `publishPermitted` is false
- a logged-out Ego exits `2` with `how_to_login`
- a mismatched `--expect-account` exits `2` only when the header identity name is different
- a logged-in header with no readable name exits `4` with `identity-not-visible`, not `ambiguous-account`
- `check-login` does not land on `/write`

Optional read-only look, still without `--save-draft`: in the same Ego window, open `https://zhuanlan.zhihu.com/write` by hand and record whether the title hint, the body, 发布, 邀请预览, 已保存, and any 保存草稿 button match `references/editor.md`. Do not click 发布. If the only save affordance is 发布, stop. This skill will not click it. Record that publishing remains unimplemented.

## One draft save

Run this only after the account owner separately allows one draft on that account. One article, one hash, one run.

```bash
node skills/zhihu-article/scripts/save-draft.mjs \
  --markdown /absolute/path/to/article.md \
  --cover /absolute/path/to/cover.png \
  --expect-account "示例作者" \
  --save-draft --json
```

Pass only if the JSON has `state: draft-saved`, `verified: true`, `publishPermitted: false`, a numeric `draftId`, and `draftUrl` ending in `/p/<id>/edit`, and a manual reopen shows the same title, body, images, and cover. `mutation` will be `autosave-verified` or `explicit-save`. Record which one the live page produced.

Anything else (`uploaded`, `unverified`, `failed`) is not a pass. Do not rerun while the receipt says `uploaded` or `unverified`. Delete or ignore the draft by hand if the editor created one.

`node skills/zhihu-article/scripts/cleanup.mjs` only closes this skill's Ego task space. It does not delete the draft.

## Still unverified until that run

- exact title placeholder, Draft.js class names, and cover input class
- whether paste keeps headings, lists, and links
- whether body images and the cover still show after reopen
- whether an id appears in the edit URL or only the 已保存 badge appears
- whether a separate 保存草稿 button exists

If the live editor never exposes a numeric draft id, v1 cannot reach `draft-saved`. That is a blocked acceptance, not a successful autosave.
