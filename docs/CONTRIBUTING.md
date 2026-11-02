# Contributing

`pinterest-download` is the reference layout. Other skills are still stubs.

- One skill per PR under `skills/<id>/`.
- Match ego layout: `SKILL.md` frontmatter, optional `agents/openai.yaml`, `scripts/*.mjs`, `references/`.
- Prefer documented ego APIs only (no Playwright imports).
- Add a short demo note or GIF path under `assets/demos/`.
- Call out ToS / personal-use limits in `references/`.
- MIT for all contributions.
- `npm test` must pass. Pinterest logic coverage is reported by c8 (line threshold 80%).
