#!/usr/bin/env bash
# Conductor archive/teardown hook: stop the dev server for this workspace.
#
# Conductor sends SIGTERM to the run script's process group on archive,
# but if the user kicked off `bun run dev` outside Conductor we still
# want a clean stop. We try the saved PID first, then fall back to
# pgrep against this exact working directory so we never touch a sibling
# workspace's dev server.
set -euo pipefail

cd "$(dirname "$0")/.."

PID_FILE=".context/dev.pid"
PORT_FILE=".context/dev.port"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE" || true)"
  if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
    kill -TERM "-$PID" 2>/dev/null || kill -TERM "$PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

# Fallback: any bun process whose cwd is this workspace.
if command -v lsof >/dev/null 2>&1 && [[ -f "$PORT_FILE" ]]; then
  PORT="$(cat "$PORT_FILE")"
  PIDS="$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  for p in $PIDS; do
    CWD="$(lsof -p "$p" -a -d cwd -Fn 2>/dev/null | awk '/^n/{print substr($0,2); exit}')"
    if [[ "$CWD" == "$PWD" ]]; then
      kill -TERM "$p" 2>/dev/null || true
    fi
  done
fi

rm -f "$PORT_FILE"
