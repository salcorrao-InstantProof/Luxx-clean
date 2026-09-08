#!/bin/bash
# LUXX video worker. Paste the token locally. Do not commit a real token.

export LUXX_BLOBS_SITE_ID="9d4faa13-d265-4c6c-b26d-d24e68496c93"
export LUXX_BLOBS_TOKEN="PASTE_YOUR_NETLIFY_TOKEN_HERE"
export LUXX_FFMPEG_PATH="${LUXX_FFMPEG_PATH:-/usr/bin/ffmpeg}"
export LUXX_FFPROBE_PATH="${LUXX_FFPROBE_PATH:-/usr/bin/ffprobe}"

cd "$(dirname "$0")"
node worker.mjs
