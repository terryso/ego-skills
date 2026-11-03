#!/usr/bin/env bash
# Publish a local video file to YouTube Studio. The caller supplies the file. This script does not download.
# usage: youtube-video-publish.sh /absolute/path/to/video.mp4 "Title" "Description"
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec bash "$ROOT/skills/youtube-video/scripts/publish.sh" "$@"
