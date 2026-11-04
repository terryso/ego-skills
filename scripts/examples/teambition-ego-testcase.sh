#!/usr/bin/env bash
# Teambition testcase commands. Phase 2a can create, update, set-status, and archive.
# delete requires --yes. Does not call the Open API.
# Usage: teambition-ego-testcase.sh parse-url <url>
#        teambition-ego-testcase.sh plan <projectId> <planId>
#        teambition-ego-testcase.sh create <projectId> <planId> --title "..."
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec node "$ROOT/skills/teambition-ego/scripts/tb.mjs" testcase "$@"
