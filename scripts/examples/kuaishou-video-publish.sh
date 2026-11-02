#!/usr/bin/env bash
# Publish a local video file. The caller supplies the file. This script does not download.
# usage: kuaishou-video-publish.sh /absolute/path/to/video.mp4 "描述 #话题" [spaceId] [keep=1]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec bash "$ROOT/skills/kuaishou-video/scripts/publish.sh" "$@"
