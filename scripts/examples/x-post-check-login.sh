#!/usr/bin/env bash
# Login-check x.com in the Ego Lite session. Does not post.
# Requires ego lite. Exit 2 if logged out or ego-browser is missing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec node "$ROOT/skills/x-post/scripts/check-login.mjs" "$@"
