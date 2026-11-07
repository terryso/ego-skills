#!/usr/bin/env bash
# Offline archive of one synthetic bookmark page. No X call. No ego-browser.
# Usage: x-bookmark-export.sh /absolute/page.json /absolute/archive 1000000000000000001
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PAGE="${1:?page json}"
ARCHIVE="${2:?absolute archive}"
ACCOUNT="${3:?account id}"
node "$ROOT/skills/x-bookmark-export/scripts/check-deps.mjs"
exec node "$ROOT/skills/x-bookmark-export/scripts/export.mjs" ingest \
  --account "$ACCOUNT" --archive "$ARCHIVE" --page "$PAGE"
