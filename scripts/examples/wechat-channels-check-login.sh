#!/usr/bin/env bash
# Login-check WeChat Channels in the Ego Lite session. Does not publish.
# Requires ego lite. Exit 2 if Channels is logged out or ego-browser is missing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec node "$ROOT/skills/wechat-channels-video/scripts/check-login.mjs" "$@"
