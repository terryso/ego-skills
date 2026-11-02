#!/usr/bin/env bash
# Edit CONFIG inside the .mjs first (ego-browser does not inherit env).
# Example smoke (Mini):
#   ego-browser nodejs < ~/.agents/skills/pinterest-download/scripts/download.mjs
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)/skills/pinterest-download/scripts"
ABS="$(cd "$(dirname "$SCRIPT_DIR/download.mjs")" && pwd)/download.mjs"
command -v ego-browser >/dev/null || { echo "ego-browser missing"; exit 1; }
ego-browser nodejs < "$ABS"
