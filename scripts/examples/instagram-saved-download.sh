#!/usr/bin/env bash
# List a few of your own Saved posts. Writes nothing into the repo.
# Requires ego lite and a logged-in Instagram session in Ego.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-/tmp/ig-saved}"
exec node "$ROOT/skills/instagram-saved-download/scripts/download.mjs" \
  list \
  --count "${IG_COUNT:-2}" \
  --out "$OUT"
