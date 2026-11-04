# Install

English: [../README.md](../README.md). 中文: [../README_CN.md](../README_CN.md).

Four working options (Claude Code marketplace, `npx skills add terryso/ego-skills`, git submodule, clone and symlink). Marketplace and `npx skills` follow the GitHub default branch.

```bash
./scripts/install-skills.sh --help
```

Prerequisite: install [ego lite](https://lite.ego.app/) and finish onboarding so `ego-browser` is on `PATH` (`command -v ego-browser`).

The installer links every shipped directory under `skills/` (`pinterest-download`, `instagram-saved-download`, `wechat-channels-video`, `kuaishou-video`, `youtube-video`, `douyin-video`, `teambition-ego`, `x-post`). Names starting with `_` (`skills/_template`) are scaffolds and are not linked. This repo is not an npm package.
