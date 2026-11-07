# Typography

The pasted article follows the light mobile column visible at `https://wechat.bmpi.dev/` after the same article is pasted with the default theme: airy justified paragraphs, a grey quote box with a thick left bar, grey centered image captions, and an underlined steel-blue link list. Styles are inline because the Official Account editor drops classes.

The values in `scripts/lib/pure.mjs` are written for that look. They are not a copy of the site's CSS.

## What this is not

`https://wechat.bmpi.dev/` is the visual reference the caller asked for. That site is the mdnice / TaleAi `markdown2html` line, which is GPL-3.0. This skill does not vendor that CSS, those theme files, or the hosted editor.

`doocs/md` (`https://github.com/doocs/md`, WTFPL) is the permissive project that documents the same paste path: Markdown to HTML, then inline styles, then paste into the editor. This skill does not depend on `@md/core`, juice, or a copy of their theme files. The implementation in `scripts/lib/pure.mjs` is original. The only borrowed fact is the widely known one: WeChat keeps inline `color` more reliably when a link's text is also wrapped in a `<span>` with the same color.

## What WeChat is asked to keep

- Body: PingFang / Hiragino / Microsoft YaHei, 16px, line-height 1.75, `#333333`, justified, 16px side margin, 1.5em between paragraphs.
- Heading 2: 22px, bold, generous vertical margin, no rule. Heading 3: 18px.
- Quote: `#f7f7f7` box, 6px `#d0d0d0` left bar.
- Links: `#576b95`, underlined, on both the `<a>` and an inner `<span>`.
- An image alt becomes a 13px grey centered caption under that image. A paragraph that is only emphasis stays italic and grey.
- Code: monospace on a paper block. There is no syntax highlighter.

Images are still uploaded as files. The editor sizes them. A caption under an image is the italic line from the Markdown, not a burned-in picture.
