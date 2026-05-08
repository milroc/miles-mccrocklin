#!/usr/bin/env bash
# Conductor run hook: boot the dev server on a port unique to this workspace.
#
# Each Conductor workspace gets its own checkout of the repo. Without a
# per-workspace port, every parallel `bun run dev` would race to bind 4317.
# We hash the workspace directory name into the 4300–4399 range so the
# port is stable across restarts of the same workspace but distinct
# between siblings.
set -euo pipefail

cd "$(dirname "$0")/.."

WORKSPACE="$(basename "$PWD")"
HASH="$(printf '%s' "$WORKSPACE" | cksum | awk '{print $1}')"
PORT="${PORT:-$((4300 + HASH % 100))}"
HOST="${HOST:-127.0.0.1}"

mkdir -p .context
echo "$PORT" > .context/dev.port
echo $$ > .context/dev.pid

echo "[$WORKSPACE] dev server → http://$HOST:$PORT"
exec env PORT="$PORT" HOST="$HOST" bun run dev
