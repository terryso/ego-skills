# Typography

The pasted article is a light page: 16px sans body, 22px headings with a bottom rule, a tinted quote, WeChat-blue links, and a quiet code block. Styles are inline on each element because the Official Account editor drops classes.

## What this is not

`https://wechat.bmpi.dev/` is the visual reference the caller asked for. That site is the mdnice / TaleAi `markdown2html` line, which is GPL-3.0. This skill does not vendor that CSS, those theme files, or the hosted editor.

`doocs/md` (`https://github.com/doocs/md`, WTFPL) is the permissive project that documents the same paste path: Markdown to HTML, then inline styles, then paste into the editor. This skill does not depend on `@md/core`, juice, or a copy of their theme files. The implementation in `scripts/lib/pure.mjs` is original. The only borrowed fact is the widely known one: WeChat keeps inline `color` more reliably when a link's text is also wrapped in a `<span>` with the same color.

## What WeChat is asked to keep

- Body: PingFang / Hiragino / Microsoft YaHei, 16px, line-height 1.85, ink `#2b2f36`.
- Heading 2: 22px, bottom border `#e6e8eb`. Heading 3: 18px.
- Quote: paper background `#f6f7f9`, 4px green bar `#2f6f4e`.
- Links: `#576b95`, which is the Official Account link blue, on both the `<a>` and an inner `<span>`.
- A paragraph that is only emphasis is a caption: 14px, centered, muted.
- Code: monospace on a paper block. There is no syntax highlighter.

Images are still uploaded as files. The editor sizes them. A caption under an image is the italic line from the Markdown, not a burned-in picture.
