#!/usr/bin/env bash
# Preview-only review command. Does not pass --yes and does not call X.
# Usage: x-bookmark-review.sh plan /absolute/archive 1000000000000000001
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMMAND="${1:?onboard|recommend|plan|consent-show}"
ARCHIVE="${2:-}"
ACCOUNT="${3:-}"
if [ "$COMMAND" = "onboard" ]; then
  ANSWERS="${2:?answers json}"
  exec node "$ROOT/skills/x-bookmark-review/scripts/review.mjs" onboard --answers "$ANSWERS"
fi
exec node "$ROOT/skills/x-bookmark-review/scripts/review.mjs" "$COMMAND" \
  --account "${ACCOUNT:?account id}" --archive "${ARCHIVE:?absolute archive}"
