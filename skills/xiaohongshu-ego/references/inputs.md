# 输入

调用方提供绝对路径和文案。本技能不下载视频，也不写死任何产品目录。

| 参数 | 必填 | 说明 |
|------|------|------|
| `--video` | 发布时必填 | 本地视频绝对路径。扩展名：`.mp4 .mov .flv .f4v .mkv .rm .rmvb .m4v .mpg .mpeg .ts` |
| `--title` | 发布时必填 | 笔记标题。界面建议大约 20 个字，超长只警告 |
| `--desc` | 发布时必填 | 正文 |
| `--topics` | 否 | 例如 `#话题1 #话题2`，会空一行后接到正文后面 |
| `--cover` | 否 | `.jpg` `.jpeg` `.png` 绝对路径，例如 `cover-3x4.png`。传入后必须确认 PK 封面换掉首帧 |
| `--expect-account` | 否 | 创作者页眉昵称。不一致则退出码 `2`，不点发布 |
| `--yes` | 真正发布时必填 | 没有它只打印计划，退出码 `3`，不上传 |
| `--json` | 否 | 成功时也打印完整 JSON |
| `--keep` | 否 | 保留页面。默认 `finish({ keep: [] })` |
| `--task-name` | 否 | 任务空间名。建议以 `xiaohongshu-ego` 开头，cleanup 才能按前缀关掉 |
| `--note-id` | 仅 `edit-cover` | explore URL 里的笔记 id |

不传 `--cover` 时，计划里的 `cover` 是 `null`，`cover_mode` 是 `platform-default-first-frame`。技能不会另找一张图。

`edit-cover.mjs` 必须带 `--note-id` 和 `--cover`。它是尽力而为，见 `publish-flow.md`。
