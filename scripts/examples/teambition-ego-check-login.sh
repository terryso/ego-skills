#!/usr/bin/env bash
# Login-check teambition.com in the Ego Lite session. Does not read or write cases.
# Requires ego lite. Exit 2 if logged out or ego-browser is missing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec node "$ROOT/skills/teambition-ego/scripts/check-login.mjs" "$@"
