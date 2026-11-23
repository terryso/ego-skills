# Local acceptance (zhihu-article)

Unit tests do not open Zhihu and do not prove this plan. Do not treat a green `npm test` as a live pass.

Unit fixtures do not prove the live homepage. Browser layout, selectors, paste formatting, and image persistence stay **unverified** until a later owner run records them.

`781b4fe` check-login on the homepage exited `0` with `BMAD实验室`. The following `save-draft` exited `2` `login-expired` immediately after opening `https://zhuanlan.zhihu.com/write`. A read-only look at that same URL showed the title box, `public-DraftEditor-content`, and the avatar, with no login wall. The write page has no `<header>` and no 创作中心/私信/消息 text; its avatar class is `AppHeader-profileAvatar`, while an earlier matcher could stop on `AppHeader-zhihuLogo`. Several contenteditables also made `bodyAmbiguous` true, so the surface stayed `home` and `loggedIn` stayed false. That false result was labeled `login-expired`.

The write-page probe now reads the profile avatar, prefers the article DraftEditor over the 创作助手, and does not call an evaluate failure a login wall.

`b7553dd` then reached the editor and exited `1` with `image-control-ambiguous` before typing. Cover was already unique. Every other file input whose accept was empty or included an image was counted as a body image, so toolbar 「图片」 was mixed with 「附件」, 「导入」, and 「AI 配图」.

`32c19aa` still exited `1` with `image-control-ambiguous` on `https://zhuanlan.zhihu.com/write` after login succeeded. `pageUrl` and `pageTitle` were present. `screenshot` was empty and the provided screenshot directory stayed empty. Two local causes: an input that was not owned by a control named exactly 图片 fell back to every remaining file input, including empty `accept` inputs, and `page.screenshot({ type: "png" })` is not the ego API. Ego writes the PNG when called as `page.screenshot({ path })` and returns that path. The body input is now the one owned by the single visible control named exactly 图片. Empty `accept`, 附件, 导入, 视频, AI 配图, cover, and 创作助手 are not candidates. If that is still not unique, the command stays `image-control-ambiguous` or `image-control-missing`. The write probe waits through the existing retries while that control is not unique, then stops. Precondition failures include `pageUrl`, `pageTitle`, and a screenshot file when a directory is available. Re-run only far enough to see whether the image gate clears. Stop before typing unless the owner separately allows one draft. `刚刚 · 草稿` after open is still not `draft-saved`. This fixture is not that live pass.

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

`4b04ffe` passed login and the image gate, wrote draft `2108325675975308707`, and exited `4` `readback-mismatch`. The title, lists, link, and two body images were present. `## 排版检查` was pasted as its own HTML fragment and came back inside the next paragraph; later headings stayed headings. Bold, italic, and the link survived, with a zero-width character before the link text. Image alts were not visible captions. The cover file path was dropped before upload, so no cover was submitted. The footer showed `刚刚 · 草稿` and `Markdown 语法输入中`, not `已保存`. `刚刚 · 草稿` on an empty editor is still not `draft-saved`. The same hash now reopens `/p/<id>/edit` and does not open another `/write`. `c3756ef` did that, then replaced the populated body and uploaded the images again. The word count doubled, the lead paragraph appeared a second time, and one image stayed on `图片上传中` until `upload-timeout`. That failure result had no `pageUrl` or `pageTitle`. A resume of a draft that already contains the article does not paste or upload body images. A block whose entire text is `图片上传中` is cleared without clicking 发布. Image upload does not treat that placeholder as a finished image. Resume failures include `pageUrl` and `pageTitle`.

## Still unverified until that run

- exact title placeholder, Draft.js class names, and cover input class
- whether paste keeps headings, lists, and links
- whether body images and the cover still show after reopen
- whether an id appears in the edit URL or only the 已保存 badge appears
- whether a separate 保存草稿 button exists

If the live editor never exposes a numeric draft id, v1 cannot reach `draft-saved`. That is a blocked acceptance, not a successful autosave.
