# Xiaohongshu Ego Lite video publish flow

Captured 2026-11-04 on creator account 听懂AI. Do not invent APIs. This skill drives the creator web UI with ego-browser.

Two public notes from that capture, after the PK cover was applied:

- https://www.xiaohongshu.com/explore/6aeae169000000000e00c4ad
- https://www.xiaohongshu.com/explore/6aeae281000000000e00cb56

The caller passes absolute paths. This file does not name a product directory.

## Preconditions

- Ego Lite and `ego-browser` on PATH
- Logged into https://creator.xiaohongshu.com as the intended account
- https://www.xiaohongshu.com may show a different account than the creator site. Always read the creator header nickname
- One video per run. The caller owns the rate limit

## Publish URL

`https://creator.xiaohongshu.com/publish/publish?from=tab_switch&source=official`

Also reachable from creator home → 发布笔记 → 上传视频.

## File inputs

1. Video: `input.upload-input[type=file]` accept `.mp4,.mov,.flv,.f4v,.mkv,.rm,.rmvb,.m4v,.mpg,.mpeg,.ts`
2. Main cover: the file input next to the control labeled `选择图片上传`. Do not use `input.pk-cover-list-file-input` for `--cover`.

Use `page.setInputFiles`. Do not open an OS file dialog. There is **no crop or confirm dialog** after the cover file is set. Do not click 确定, 完成, or a crop control.

## When the video is ready

Wait until the body no longer matches `/上传中\s*\d+%/` and shows 重新上传 or 设置封面.

The platform then uses the **video first frame** as the main cover until 「选择图片上传」 replaces it. A PK-slot upload does not do that.

## Cover, required when `--cover` is set

Verified on 2026-11-04 with note 053: 「选择图片上传」 sets the **main** cover. After that control was used, the published note's cover was the custom image.

PK slots are a different control (`input.pk-cover-list-file-input`). Filling only those leaves the main cover and the note-manager thumbnail as the video first frame, badged 封面待PK, until the 72-hour PK ends. `--cover` does not upload a PK slot.

The script:

1. Finds the element whose text is exactly `选择图片上传`.
2. Uses the `input[type=file]` next to that control. It refuses `input.upload-input` and `input.pk-cover-list-file-input`. No other class name is assumed.
3. Calls `setInputFiles` on that input.
4. Waits until the main-cover preview `img` (not an image inside a `pk-cover` node) changes.
5. Retries the file input once. If the preview does not change, exits `1` and does not click 发布.

Without `--cover`, do not invent an image. Leave the first frame and say so in the plan.

## Form fields

- Title: `page.fill` on the input whose placeholder is 「填写标题」. The page counter weighs ASCII as half a unit: `两台Mac跑816B大模型｜听懂AI #053` is 16/20. Do not use `element.value` plus a synthetic event.
- Body: click the ProseMirror editor (`.ProseMirror`) and `keyboard.insertText`. Description, a blank line, then topics (`#a #b`).
- 发布 is not always a `<button>`. Use the element whose text is exactly `发布` (a div on the 2026-11-04 page) and click its center. Do not use `button:text-is("发布")` alone.
- Account gate: the creator nickname must match `--expect-account` before upload and again before 发布. A header nickname wins over other text on the page.

## Publish

- Click the control whose text is exactly `发布` (not 暂存离开, not 发布笔记).
- Success: URL contains `/publish/success` and the page says 「发布成功」.
- Note id: open `https://creator.xiaohongshu.com/new/note-manager`, take the first `.note-card` whose text contains the title, parse `data-impression` JSON, read `noteTarget.value.noteId`.
- Public URL: `https://www.xiaohongshu.com/explore/<noteId>`

If 发布成功 was seen but the note id cannot be read, exit `1` and do not run `--yes` again for the same file.

## Edit cover (best-effort, not the main path)

Prefer the pre-publish swap above. `scripts/edit-cover.mjs` is only for a note that already went out.

Verified path for note `6aeae281000000000e00cb56`:

1. Note manager → 编辑
2. `https://creator.xiaohongshu.com/publish/update?id=<noteId>&noteType=video`
3. The same 「选择图片上传」 main-cover input, not `input.pk-cover-list-file-input`
4. The main-cover preview must change before 发布
5. Footer button whose text is exactly `发布`

Caveats from the same session:

- Saving can send the note back to 审核中
- The manager can show the badge 封面PK中
- Another note disappeared from the manager, and its update URL showed 加载失败

If the update page says 加载失败, do not click 发布. Do not treat a failed edit as a reason to publish a new note.

## Hard rules

- `--yes` is required to upload or to click 发布. Without it: validate, check login, print the plan JSON (including the cover path), exit `3`
- Title, description, and topics cannot contain links (`http(s)://`, `www.`, bare domains such as `github.com/xxx` or `x.com/xxx`, `t.co`). The same check runs on a dry run. Without `--strip-links` the command exits `4` and lists the fragments. `--strip-links` removes the links, a dangling `项目地址：` or `链接：` on that line, and leftover blank lines, then prints what was removed.
- `finish({ keep: [] })` unless `--keep`
- Exit `2` when ego-browser is missing, the creator site is logged out, or `--expect-account` does not match
- No MCP. No batch loop. No image-only notes. No scheduled publish. No delete
