## Summary

<!-- What changed, and which skill id if any. -->

## Type

- [ ] New skill (`skills/<id>/`)
- [ ] Fix existing skill
- [ ] Docs / tooling only

## Checklist

- [ ] ego-browser skill. `ego-browser` is in frontmatter `requires.bins`. No Playwright, Puppeteer, or cloud-browser MCP as the primary path. If this is not an ego-browser skill, close the PR and use [claw-skills](https://github.com/terryso/claw-skills) or your own repo with `npx skills add`.
- [ ] No personal or product absolute paths. Examples use `/tmp/...` or `/absolute/path/to/video.mp4`.
- [ ] Login soft-fail is documented (exit `2` + `how_to_login`). The skill never types a password, never pastes cookies, and never automates a QR scan.
- [ ] Video skills: caller-supplied local file; publish skills do not download video. Success state is written in `SKILL.md` (under review / private URL / draft saved / publish-success copy). No auto-click on a Publish control that needs a human QR scan. WeChat Channels stays draft-only.
- [ ] `npm run hygiene` and `npm test` are green. New logic lives under `scripts/lib/` other than `ego-deps.mjs`, so the c8 glob counts it (lines ≥ 80%). CI runs both. It does not log in to Ego.
- [ ] `README.md` and `README_CN.md` updated when the user-facing skill list or behavior changes. Marketplace / plugin blurb updated for a new skill.
- [ ] I am allowed to contribute these changes under the MIT license. Attribution is noted if this ports another project. No DCO or CLA.
- [ ] Local Ego smoke (optional, not required to merge). Commands and result below, or an explicit “not run”. Maintainers may add `needs-ego-smoke`.

## Test commands

```bash
npm test
```

## Notes for maintainers

<!-- Login behavior, terms of service, demo GIF or why there is none. -->
