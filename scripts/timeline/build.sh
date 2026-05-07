#!/usr/bin/env bash
# Convert a Been-app "timeline" video export into structured JSON.
#
# Pipeline: ffmpeg → frame stitching → Apple Vision OCR → parser
#
# Usage:
#   scripts/timeline/build.sh <input.MP4> <output.json> [work-dir]
#
# Requires: ffmpeg, swift (Vision framework, macOS), Python with PIL+numpy
# (auto-managed in scripts/.venv).

set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: $0 <input.MP4> <output.json> [work-dir]" >&2
  exit 2
fi

IN="$1"
OUT="$2"
WORK="${3:-$(mktemp -d -t been-timeline)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && cd .. && pwd)"
VENV="$ROOT/scripts/.venv"
PY="$VENV/bin/python"

if [ ! -x "$PY" ]; then
  echo "creating venv at $VENV…" >&2
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --quiet pillow numpy
fi

mkdir -p "$WORK/frames"
echo "[1/4] extracting frames → $WORK/frames" >&2
ffmpeg -loglevel error -y -i "$IN" "$WORK/frames/f%04d.png"

echo "[2/4] stitching" >&2
"$PY" "$HERE/stitch.py" "$WORK/frames" "$WORK/stitched.png"

echo "[3/4] OCR" >&2
swift "$HERE/ocr.swift" "$WORK/stitched.png" > "$WORK/ocr.json"

echo "[4/4] parse → $OUT" >&2
"$PY" "$HERE/parse.py" "$WORK/ocr.json" "$WORK/stitched.png" "$OUT"

echo "done. work dir: $WORK" >&2
