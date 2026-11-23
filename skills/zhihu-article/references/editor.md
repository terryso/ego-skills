# Editor contract (zhihu-article)

This file describes the visible contract the script requires. It is **not** a live capture. Selector hints below were **not** confirmed in a logged-in Zhihu session for this change. If the live page does not match, the script stops and does not click 发布.

## Pages

| Step | URL | Write? |
|------|-----|--------|
| Login check | `https://www.zhihu.com/` | No |
| Article editor, only after `--save-draft` | `https://zhuanlan.zhihu.com/write` | Opening it can autosave |
| Reopen, only after one numeric id is observed | `https://zhuanlan.zhihu.com/p/<id>/edit` | Read |

The edit URL is built from a numeric id observed in the page URL or in a visible link. Query secrets are redacted. A `/p/<id>` URL without `/edit` is treated as a public article. The script stops and does not call that a draft.

## What the probe must see

An article surface requires all of:

- host ends with `zhihu.com`
- path is `/write` or `/p/<digits>/edit`
- one visible title field whose hint contains 标题 and does not contain 回答, 想法, or 评论
- exactly one visible contenteditable body

`public-DraftEditor-content` is only a hint when several editables exist. A question path, a 写回答 field, a 想法 path, or a 写评论 field is not an article. A mixed page is `unsupported-surface`.

The editor must be blank (empty title, empty body, no images) before typing. Existing text is `editor-not-blank` and is not overwritten. If the blank page already has one draft id, later reads must keep that same id.

## Controls that are never clicked

- 发布
- 发表
- anything containing 定时
- 邀请预览

File inputs may be zero-size. That is the control behind a visible upload button, the same pattern as `wechat-article-ego`. A disabled file input is ignored. The body image input is the file input owned by the one visible control whose name is exactly 图片. Ownership is the input inside that control, or the only image file input under an ancestor that contains that one control. An empty `accept` is not an image input. Cover (封面, 题图, `UploadPicture`, or `cover`), 附件, 导入, 视频, AI 配图, and inputs inside 创作助手 are not body images. A label that only contains 图片, such as AI 配图, is not the toolbar control. If more than one input still matches, the one whose `accept` starts with `image/webp` and has `multiple` is used only when it is the only such input. Otherwise the command stops. Unlabeled file inputs are not a fallback.

## Save signal

The published help says a draft autosaves and the top of the page shows 已保存. The script treats that badge as necessary and not sufficient. A badge inside the article body does not count. Text that contains 发布 does not count.

If a visible button is exactly 保存草稿, 存草稿, or 保存为草稿, it is clicked once with a pointer click. A second call does not click again. If that button is present, autosave alone is `unverified` with `autosave-without-explicit-save`.

If that button is absent, the script waits for 已保存 and one draft id, then reopens the edit URL. It does not click 发布 to force an id. No id means `draft-id-unobserved` or `autosave-timeout`, state `unverified` when text was entered, or `uploaded` when a file was submitted and no id appeared.

## Readback

After reopen, the script compares:

- title
- paragraph and image-alt text
- heading level and text
- list item text
- absolute http(s) hrefs
- image count inside the body
- cover preview when `--cover` was passed
- the 已保存 badge
- the same draft id

Raw HTML left in the body text fails the readback. Image order and whether a pasted heading survives the live editor are **unverified**. A unit fixture can satisfy this contract without proving the live page will.

## Timeouts

Upload and autosave each poll 20 times, 500ms apart, unless a test injects a shorter timing. A timeout does not submit the file again and does not click the draft button again.
