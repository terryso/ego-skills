#!/usr/bin/env bash
# Read-only Teambition testcase commands (Phase 1). Does not write to Teambition.
# Usage: teambition-ego-testcase.sh parse-url <url>
#        teambition-ego-testcase.sh plan <projectId> <planId>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec node "$ROOT/skills/teambition-ego/scripts/tb.mjs" testcase "$@"
