# Editor

The only page is the public Official Account console at `https://mp.weixin.qq.com/`. Use the visible editor. Do not replay a private API, copy a token out of the URL, or sniff uploads.

## Open

1. Land on the console.
2. Read the nickname. One account continues. Zero or several accounts stop before any write.
3. Click 新的创作, then 文章. If that opens a popup, continue on the popup page.
4. Ready when a title field (placeholder contains 标题) or an editable body / editor iframe is present.

## Write

- Title: `page.fill` on the title field, or the native value setter if fill cannot see it.
- Body: focus the editable body and `page.keyboard.paste({ text, html })`. HTML keeps headings, paragraphs, quotes, lists, emphasis, and links. Inline styles ask for a 16px body, 18px headings, and a monospace family so the hierarchy is close to a terminal blog. WeChat may drop `font-family`.
- Images: split the body at each image. After the preceding HTML is pasted, open the image control (`title` 图片 or the insert-image button) and use `waitForFileChooser` or `setInputFiles`. Confirm 确定 / 确认 / 插入 only while an image dialog is open. The next paste continues after the image. The image count must increase before the next block.
- Captions stay as the italic or normal paragraphs that follow the image in the markdown. They are text, not a burned-in picture.
- Digest and 原文链接 are filled only when those fields exist.
- Cover: if the page shows an empty 封面 control, choose 从正文选择 and the first uploaded image, which is the article's own first image. If that control is missing and a cover file input is labeled as a cover, upload that same first image. If the cover is required and neither control works, stop without 保存.

## Save and check

Click a control whose exact label is 保存草稿 or 保存.

Never click a control whose label contains 发表, 群发, 定时群发, or 发送预览. 预览 is allowed only when the exact label is 预览, and only to screenshot an on-screen preview. Do not send that preview to a person.

After 保存, open 草稿箱. Exactly one row with the same title means the draft landed. Reopen that row and compare title, text, and image count. Zero rows or several rows leave the receipt `uncertain` and do not click 保存 again.

Before `finish({ keep: [] })`, clear `onbeforeunload` so the close dialog cannot turn into another save.

## Fidelity

Report these when they apply. Do not drop the source text to hide them.

- Syntax highlighting is not available. Fenced code stays as text.
- Mermaid and other embeds stay as source text. They are not executed.
- Remote images are uploaded, not left as hotlinks.
- Link text is required. If the href does not survive paste, the difference is reported and the text still has to be present.
- Categories and tags are not copied. There is no safe field for them.
- The author field is not filled.
