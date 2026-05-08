#!/usr/bin/env bash
# Conductor setup hook: install dependencies for a fresh workspace.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found on PATH. Install via 'curl -fsSL https://bun.sh/install | bash' or 'brew install oven-sh/bun/bun'." >&2
  exit 1
fi

bun install --frozen-lockfile
