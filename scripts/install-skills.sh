#!/usr/bin/env bash
# Link each skills/<id> into the agent skills directory.
# Usage: ./scripts/install-skills.sh
# Override destination: EGO_SKILLS_HOME=/path ./scripts/install-skills.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${EGO_SKILLS_HOME:-${HOME}/.agents/skills}"
mkdir -p "$DEST"
linked=0
for dir in "$ROOT"/skills/*; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  target="$DEST/$name"
  if [ -L "$target" ] || [ ! -e "$target" ]; then
    ln -sfn "$dir" "$target"
    echo "linked $name -> $target"
    linked=$((linked + 1))
  else
    echo "skip $name: $target exists and is not a symlink" >&2
  fi
done
echo "[ego-skills] $linked skill(s) linked into $DEST"
