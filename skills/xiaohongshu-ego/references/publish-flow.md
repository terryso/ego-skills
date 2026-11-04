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
2. Cover (PK): `input.pk-cover-list-file-input[type=file]` accept `.jpg,.jpeg,.png`

Use `page.setInputFiles`. Do not open an OS file dialog. There is **no crop or confirm dialog** after the cover file is set. Do not click 确定, 完成, or a crop control.

## When the video is ready

Wait until the body no longer matches `/上传中\s*\d+%/` and shows 重新上传 or 设置封面.

The platform then uses the **video first frame** as the cover unless a PK cover is confirmed.

## Cover, required when `--cover` is set

Live check on 2026-11-04:

- The input is `input.pk-cover-list-file-input`
- After `setInputFiles`, the toast is 「已添加 PK 封面」
- The counter moves, for example `0/3` → `1/3`
- No crop dialog appears

The script must see **both** the toast and a higher counter before it clicks 发布. It retries the file input once. If the second try still lacks the toast or the counter did not advance, the run exits `1` and does **not** click 发布. Publishing the first frame is worse than failing.

Without `--cover`, do not invent an image. Leave the first frame and say so in the plan.

## Form fields

- Title: the title box whose placeholder is 「填写标题」, or the first single-line text box labeled 标题. About 20 Chinese characters is what the UI recommends. Longer titles are sent with a warning, not blocked here.
- Body: the contenteditable or multiline field. Description, a blank line, then topics (`#a #b`).
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
3. The same `input.pk-cover-list-file-input`
4. The same toast and counter check
5. Footer button whose text is exactly `发布`

Caveats from the same session:

- Saving can send the note back to 审核中
- The manager can show the badge 封面PK中
- Another note disappeared from the manager, and its update URL showed 加载失败

If the update page says 加载失败, do not click 发布. Do not treat a failed edit as a reason to publish a new note.

## Hard rules

- `--yes` is required to upload or to click 发布. Without it: validate, check login, print the plan JSON (including the cover path), exit `3`
- `finish({ keep: [] })` unless `--keep`
- Exit `2` when ego-browser is missing, the creator site is logged out, or `--expect-account` does not match
- No MCP. No batch loop. No image-only notes. No scheduled publish. No delete
