# 贴图 editor (type 77)

A 贴图 is an Official Account image post, not an article and not a Channel. The visible editor is still `https://mp.weixin.qq.com/`. Do not replay a private upload API, copy a token into a log, or fill the 链接 field.

## Open

1. Land on the console and read the nickname. One account continues. Zero or several accounts stop before any write.
2. Click 新的创作, then 贴图. That opens a popup. Continue on the popup (`page.waitForEvent("popup")`).
3. If the popup does not become the editor, open the new-post URL with the token already in the signed-in page:

`cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&createType=8&token=<session>&lang=zh_CN`

Ready when two `.ProseMirror` fields are present. The URL's `type` is `77`.

## Write

- Images: `page.setInputFiles('xpath=(//input[@type="file"])[2]', [path])`. The first file input belongs to a menu. The second is the main uploader. Upload one path at a time, in order. The first image is the cover. Wait until a thumbnail appears in the body. A fixed sleep is not the check.
- Title: the first `.ProseMirror` (counter `n/20`). Click it, then `keyboard.insertText`. 20 characters is the limit. A longer title fails before the browser opens.
- Body: the second `.ProseMirror` (counter `n/1000`). Clicking it fails because another `div` intercepts pointer events. Call `focus()` and move the caret to the end instead.
- `keyboard.insertText` drops `\n`. Put each line in its own `insertText`, and press Enter between lines. Enter becomes a `<br>`.
- Bare URLs stay on their own plain-text lines when the source already has them on their own lines. A URL inside a sentence stays in that sentence. Do not open the 链接 field for them. That field only accepts 公众号内容, a 小程序, or a 小店, so an external URL would not become a link. Say that in the plan: external URLs are not clickable.
- Topics: the caller passes names without `#` and without spaces. In the body, type `#`, then the name. The editor wraps it in `<a class="wx_topic_link" topic-id="…" data-topic="1">`. A space, then another `#`, starts the next topic. There is no dropdown and no Enter between topics. Type the body first, then a line break, then the topics.

The 1000-character budget counts the body text, including URLs, plus the newline and `#name` topics that are typed into the same field.

## Save and check

Click the exact label 保存为草稿. 发表 and 预览 sit next to it. Do not click them. Do not click 群发, 定时群发, or 发送预览.

After the click, the page toasts 已保存, the URL gains `appmsgid`, and the footer shows `HH:MM 已保存`. The editor also autosaves, so another click would update the same draft. This command clicks once. If that click's result is not one identifiable draft, exit `4` and do not click again.

Reopen for verification, not the read-only card preview:

`cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=<id>&token=<session>&lang=zh_CN`

The draft list, if needed to find an id, is:

`cgi-bin/appmsg?begin=0&count=10&type=77&action=list_card&token=<session>&lang=zh_CN`

Card titles use `a.weui-desktop-publish__cover__title`. That link opens a preview. Do not use it as the verification page.

Read the reopened editor: title from the first `.ProseMirror`, body `innerText` from the second, topic texts from `a.wx_topic_link`, image count, `type` 77, `appmsgid`, and the footer time. Those fields are the success JSON.

Before `finish({ keep: [] })`, clear `onbeforeunload` so the close dialog cannot turn into another save.
