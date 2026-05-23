#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
lanes_root="${REPRINT_PUSH_LANES_DIR:-"$HOME/reprint-experimental-push-lanes"}"

printf '%s\n' "tmux sessions:"
tmux list-sessions 2>/dev/null | sed -n '/^rp-/p' || true

printf '\n%s\n' "worktrees:"
git -C "$repo" worktree list

if [ -d "$lanes_root" ]; then
  printf '\n%s\n' "lane git state:"
  for worktree in "$lanes_root"/*; do
    [ -d "$worktree/.git" ] || continue
    printf '\n## %s\n' "$(basename "$worktree")"
    git -C "$worktree" status --short --branch
  done
fi

