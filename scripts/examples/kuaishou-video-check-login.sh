#!/usr/bin/env bash
# Login-check the Kuaishou creator platform in the Ego Lite session. Does not publish.
# Requires ego lite. Exit 2 if logged out or ego-browser is missing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec node "$ROOT/skills/kuaishou-video/scripts/check-login.mjs" "$@"
