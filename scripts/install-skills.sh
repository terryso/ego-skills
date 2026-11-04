#!/usr/bin/env bash
# Link skills/* into agent skill directories.
# Skills shipped: pinterest-download, instagram-saved-download, wechat-channels-video, kuaishou-video, youtube-video, douyin-video.
# Prerequisite: ego lite installed, `ego-browser` on PATH.
#
#   ./scripts/install-skills.sh
#       -> ~/.agents/skills   (Codex, and the shared agents path)
#   ./scripts/install-skills.sh --agent claude
#       -> ~/.claude/skills
#   ./scripts/install-skills.sh --agent cursor
#       -> ~/.cursor/skills
#   ./scripts/install-skills.sh --agent openclaw
#       -> ~/.openclaw/skills
#   ./scripts/install-skills.sh --all
#   EGO_SKILLS_HOME=/path ./scripts/install-skills.sh
#
# Paths match the public `skills` CLI (npx skills add), not a private installer.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

agent_dest() {
  case "$1" in
    agents|codex) printf '%s\n' "${HOME}/.agents/skills" ;;
    claude|claude-code) printf '%s\n' "${HOME}/.claude/skills" ;;
    cursor) printf '%s\n' "${HOME}/.cursor/skills" ;;
    openclaw) printf '%s\n' "${HOME}/.openclaw/skills" ;;
    *)
      echo "unknown agent: $1 (use agents, codex, claude, cursor, openclaw)" >&2
      return 1
      ;;
  esac
}

destinations=()
if [ "${1:-}" = "--all" ]; then
  destinations+=("$(agent_dest agents)" "$(agent_dest claude)" "$(agent_dest cursor)" "$(agent_dest openclaw)")
else
  while [ $# -gt 0 ]; do
    case "$1" in
      --agent)
        shift
        destinations+=("$(agent_dest "${1:-}")")
        ;;
      --help|-h)
        sed -n '2,17p' "$0"
        exit 0
        ;;
      *)
        echo "unknown argument: $1" >&2
        exit 1
        ;;
    esac
    shift
  done
fi

if [ ${#destinations[@]} -eq 0 ]; then
  destinations+=("${EGO_SKILLS_HOME:-${HOME}/.agents/skills}")
fi

link_into() {
  local dest="$1"
  local linked=0
  mkdir -p "$dest"
  for dir in "$ROOT"/skills/*; do
    [ -d "$dir" ] || continue
    local name target
    name="$(basename "$dir")"
    target="$dest/$name"
    if [ -L "$target" ] || [ ! -e "$target" ]; then
      ln -sfn "$dir" "$target"
      echo "linked $name -> $target"
      linked=$((linked + 1))
    else
      echo "skip $name: $target exists and is not a symlink" >&2
    fi
  done
  echo "[ego-skills] $linked skill(s) linked into $dest"
}

for dest in "${destinations[@]}"; do
  link_into "$dest"
done
