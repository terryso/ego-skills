#!/usr/bin/env bash
# Draft or send one X post through the Ego Lite session.
# Without --yes the underlying script prints a draft and exits 3.
# Usage: x-post.sh --text "..." [--yes] [--reply-to <statusId>] [--json]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec node "$ROOT/skills/x-post/scripts/post.mjs" "$@"
