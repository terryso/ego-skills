# Inputs (zhihu-article)

Callers pass absolute paths. Examples use `/absolute/path/to/article.md` and `/absolute/path/to/cover.png`. The skill does not bake in a home directory or a person's name.

## Article source

Pass exactly one of:

- `--markdown /absolute/path/to/article.md`
- `--text "plain paragraph"` with `--title`
- `--text-file /absolute/path/to/body.txt` with `--title`

Optional YAML frontmatter may set `title` and `description`. `description` is not copied into Zhihu. `--title` overrides the frontmatter title and an H1. A matching H1 is not repeated in the body.

## Markdown that is kept

- paragraphs
- `#` / `##` / `###` headings (`#` used as the title is not pasted again)
- `**bold**` and `*italic*`
- `[label](https://example.com/docs)` links
- one-level `-` and `1.` lists
- a local image on its own line: `![配图](./image.png)` or an absolute path

Relative images must stay inside the Markdown file's directory or `--asset-root`. Absolute image paths are the caller's responsibility.

## Rejected before any browser launch

- remote or `data:` images
- GIF, WebP, truncated files, and files whose extension does not match the bytes
- images over 5 MiB (the published suggestion is 不超过 5M)
- a cover that is not wider than 330px and taller than 100px
- fenced code, inline code, tables, blockquotes, raw HTML, math, footnotes, wiki embeds, nested lists, headings deeper than h3, thematic breaks
- `javascript:` and other non-http(s) links

PNG and JPG only, matching the published article help. Body images have no local dimension minimum. The cover minimum is the published 题图 rule.

## Flags that are not content

`--cover` is optional and must be absolute. `--expect-account` is only for `check-login` and `save-draft`. `--receipt-dir` and `--screenshot-dir` are only for `save-draft`. `preview` rejects them because preview is offline.

`--publish`, `--yes`, `--schedule`, `--answer`, `--idea`, `--comment`, `--kind`, and `--keep` are refused.
