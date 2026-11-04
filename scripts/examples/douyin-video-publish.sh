#!/usr/bin/env bash
# Publish a local video file. The caller supplies the file. This script does not download.
# usage: douyin-video-publish.sh /absolute/path/to/video.mp4 "title" "description" [spaceId] [keep=1]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec bash "$ROOT/skills/douyin-video/scripts/publish.sh" "$@"
