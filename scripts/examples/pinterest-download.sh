#!/usr/bin/env bash
# Tiny example. Writes nothing into the repo.
# ego-browser nodejs does not take query/count/out as argv; the .mjs CLI does.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-/tmp/ego-pinterest-wallpaper}"
exec node "$ROOT/skills/pinterest-download/scripts/download.mjs" \
  --query "${PINTEREST_QUERY:-wallpaper}" \
  --count "${PINTEREST_COUNT:-2}" \
  --out "$OUT"
