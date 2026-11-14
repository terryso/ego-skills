# 贴图 editor (type 77)

A 贴图 is an Official Account image post, not an article and not a Channel. The visible editor is still `https://mp.weixin.qq.com/`. Do not replay a private upload API, copy a token into a log, or fill the 链接 field.

## Open

1. Land on the console and read the nickname. One account continues. Zero or several accounts stop before any write.
2. Click 新的创作, then 贴图. That opens a popup. Continue on the popup (`page.waitForEvent("popup")`).
3. If the popup does not become the editor, open the new-post URL with the token already in the signed-in page:

`cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&createType=8&token=<session>&lang=zh_CN`

Ready when two `.ProseMirror` fields are present. The URL's `type` is `77`.

## Write

- Images: `page.setInputFiles('xpath=(//input[@type="file"])[2]', [path])`. The first file input belongs to a menu. The second is the main uploader. Upload one path at a time, in order. The first image is the cover. The body ProseMirror often stays at 0 images; the thumbnail is elsewhere in the uploader. Poll for up to 30 seconds. Any one of these is enough: an `img`, `canvas`, or `background-image` thumbnail in the uploader area; a higher image count; the chosen file input's value or children changing; the empty-upload placeholder disappearing; or a response whose URL contains `filetransfer` or `uploadimg`. On failure, write `tietu-upload-failed.png` and a trimmed `tietu-upload-failed.html` of the uploader region under the screenshot or receipt directory, and put both paths plus every file input's `accept` in the error JSON. Do not click 删除 or 不保存 while dumping that debug.
- Title: the first `.ProseMirror` (counter `n/20`). Click it, then `keyboard.insertText`. 20 characters is the limit. A longer title fails before the browser opens.
- Body: the second `.ProseMirror` (counter `n/1000`). Clicking it fails because another `div` intercepts pointer events. Call `focus()` and move the caret to the end instead.
- `keyboard.insertText` drops `\n`. Put each line in its own `insertText`, and press Enter between lines. Enter becomes a `<br>`.
- Bare URLs stay on their own plain-text lines when the source already has them on their own lines. A URL inside a sentence stays in that sentence. Do not open the 链接 field for them. That field only accepts 公众号内容, a 小程序, or a 小店, so an external URL would not become a link. Say that in the plan: external URLs are not clickable.
- Topics: the caller passes names without `#` and without spaces. In the body, type `#`, then the name. The editor wraps it in `<a class="wx_topic_link" topic-id="…" data-topic="1">`. A space, then another `#`, starts the next topic. There is no dropdown and no Enter between topics. Type the body first, then a line break, then the topics.

The 1000-character budget counts the body text, including URLs, plus the newline and `#name` topics that are typed into the same field.

## Save and check

After the last keystroke, wait up to 30 seconds for the editor autosave: footer `HH:MM已保存`, an `appmsgid` on the URL, or `operate_appmsg` with `ret` 0. Record whether that request's `cdn_url0` and `share_imageinfo0` are non-empty. Ego Lite does not emit `page.on("request")`, so the hook is installed in the page (`XMLHttpRequest` and `fetch`, stashed on `window.__egoSaves`). `page.on` is only a fallback. If no save request is observed, that is a warning when the reopened draft and the 贴图 list (`item_show_type` 8, same `appmsgid`, at least one image) already agree. A request that is observed with empty image fields is a failure. Only then click 保存为草稿 with `page.click` or `locator.click`. Do not use an in-page `el.click()`; that can submit before the image list has synced. The manual save must keep the autosave `appmsgid`. If the save request's image fields are empty, or the id changes, stop and report both ids.

Click the exact label 保存为草稿 once. 发表 and 预览 sit next to it. Do not click them. Do not click 群发, 定时群发, or 发送预览.

After the click, stay on that editor tab for up to 20 seconds. Do not open the draft list, do not reopen another URL, and do not close the tab during the wait: leaving early can discard an unsaved editor. Confirmation is an `appmsgid` on the URL, or `appMsgId` in the save response JSON when `ret` is 0. A 「已保存」 toast or `HH:MM 已保存` footer is recorded, but it is not an id. Before any later navigation, write `tietu-save-confirm.png` and a receipt with the redacted URL, the toast text, and `{ ret, appMsgId }`. If no `appmsgid` arrives, the error is `save not confirmed` and the command does not call that a readback mismatch. The editor also autosaves, so another click would update the same draft. This command clicks once.

When an id exists, reopen the edit URL below and poll until the title ProseMirror is non-empty (up to 20 seconds) before comparing. Then open the type 77 draft list and check that the id or title is there. The list navigation happens only after the save wait and the editor read.

Reopen for verification, not the read-only card preview:

`cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=<id>&token=<session>&lang=zh_CN`

The draft list, used only as a cross-check after the edit page has been read, is:

`cgi-bin/appmsg?begin=0&count=10&type=77&action=list_card&token=<session>&lang=zh_CN`

Card titles use `a.weui-desktop-publish__cover__title`. That link opens a preview. Do not use it as the verification page.

Read the reopened editor: title from the first `.ProseMirror`, body `innerText` from the second, topic texts from `a.wx_topic_link`, image count, `type` 77, `appmsgid`, and the footer time. Those fields are the success JSON. Image count is the number of distinct picture URLs in `.image-selector` (the main preview `.image-selector__preview-center-img` and the strip). The same upload shown again as the preview, a strip thumb, and the left card is one image. Do not count every `mmbiz` image on the page.

The save-confirm screenshot is a full-page capture of the editor after the toast, `tietu-save-confirm.png`. If that file cannot be written, the command fails and the JSON includes `screenshotError`.

Do not click 保存为草稿 until `.image-selector` shows the expected number of distinct `mmbiz` / `mmbiz.qpic.cn` pictures (the preview and the strip, deduped). A file-input value, an upload response, or the empty 「选择或拖拽图片」 placeholder is only a hint. The wait is up to 60 seconds. If the pictures are not on the CDN, exit `1` and do not save.

After a confirmed id, the type 77 draft list must contain that draft with `item_show_type` 8. A card on the 文章 list, or a show type other than 8, is `draft was saved as an article, not a 贴图`.

Reopen only navigates to that edit URL and reads. It does not click 删除, 废弃, 丢弃, 不保存, or a confirm that would discard the draft. Clearing `onbeforeunload` only stops the close dialog; it does not delete the draft.

Before `finish({ keep: [] })`, clear `onbeforeunload` so the close dialog cannot turn into another save.
