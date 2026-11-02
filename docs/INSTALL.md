# Install

English and 中文.

## English

1. Install [ego lite](https://lite.ego.app/) and finish onboarding so `ego-browser` is on `PATH` (`~/.local/bin` on macOS).
2. Confirm: `command -v ego-browser && ego-browser skill | head`.
3. Clone `https://github.com/terryso/ego-skills.git`.
4. Run `./scripts/install-skills.sh` to symlink `skills/*` into `~/.agents/skills/` (`EGO_SKILLS_HOME` overrides the directory).
5. Re-index the agent. `node` must be on `PATH` for `pinterest-download`.

Day-to-day browser work still follows `ego-browser skill` for the installed Ego Lite version.

## 中文

1. 安装 [ego lite](https://lite.ego.app/) 并完成引导，使 `ego-browser` 在 `PATH` 上（macOS 通常是 `~/.local/bin`）。
2. 确认：`command -v ego-browser && ego-browser skill | head`。
3. 克隆 `https://github.com/terryso/ego-skills.git`。
4. 运行 `./scripts/install-skills.sh`，把 `skills/*` 链接到 `~/.agents/skills/`（可用 `EGO_SKILLS_HOME` 改目录）。
5. 让 Agent 重新索引技能。运行 `pinterest-download` 还需要 `node` 在 `PATH` 上。

日常浏览器操作仍以当前 Ego Lite 的 `ego-browser skill` 指南为准。
