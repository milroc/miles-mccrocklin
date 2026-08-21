#!/usr/bin/env bash
# The gate, in one place: the same two commands .github/workflows/lint.yml
# runs, so a local failure and a CI failure are always the same failure.
#
# Checks a COMMIT, not the working tree. That distinction is the whole
# design. Linting the working tree is simpler, but it fails on scratch
# code that was never going to be pushed — a debugging hook, a commented
# experiment — and a gate that cries wolf is a gate everyone learns to
# pass --no-verify to. What reaches a reviewer is the commit, so that is
# what gets checked.
#
# Usage: preflight.sh [ref]   (defaults to HEAD)
set -uo pipefail

root="$(git rev-parse --show-toplevel)" || exit 1
ref="${1:-HEAD}"
sha="$(git -C "$root" rev-parse --verify "$ref^{commit}" 2>/dev/null)" || {
  echo "preflight: no such commit: $ref" >&2
  exit 1
}

# A detached worktree of exactly that commit. It shares the object store,
# so this costs a checkout rather than a clone, and node_modules is
# borrowed rather than installed.
tmp="$(mktemp -d)" || exit 1
cleanup() {
  git -C "$root" worktree remove --force "$tmp" >/dev/null 2>&1
  rm -rf "$tmp"
}
trap cleanup EXIT

if ! git -C "$root" worktree add --detach -q "$tmp" "$sha" 2>/dev/null; then
  echo "preflight: could not create a worktree for $ref" >&2
  exit 1
fi
ln -s "$root/node_modules" "$tmp/node_modules"

short="$(git -C "$root" rev-parse --short "$sha")"
printf '\033[1mpreflight\033[0m  %s\n' "$short"

fail=0
( cd "$tmp" && bun run lint ) || fail=1
( cd "$tmp" && bun run typecheck ) || fail=1

if [ "$fail" -ne 0 ]; then
  cat >&2 <<MSG

────────────────────────────────────────────────────────────────────
Preflight failed on $short. This is the same check CI runs, so pushing
now produces a red pull request rather than a surprise.

Note this is your COMMIT, not your working tree — fixing the file on
disk is not enough, the fix has to be committed.

    bun run lint
    bun run typecheck
    bun run lint -- --fix     # the mechanical ones

If you need to share work in progress, open the pull request as a draft
rather than reaching for --no-verify.
────────────────────────────────────────────────────────────────────
MSG
  exit 1
fi

printf '\033[1mpreflight\033[0m  clean\n'
