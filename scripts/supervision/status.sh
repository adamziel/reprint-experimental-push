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
  while IFS= read -r worktree; do
    [ -e "$worktree/.git" ] || continue
    git -C "$worktree" rev-parse --is-inside-work-tree >/dev/null 2>&1 || continue
    lane_label="${worktree#"$lanes_root"/}"
    printf '\n## %s\n' "$lane_label"
    git -C "$worktree" status --short --branch
    if git -C "$worktree" rev-parse --verify origin/main >/dev/null 2>&1; then
      ahead_main="$(git -C "$worktree" rev-list --count origin/main..HEAD)"
      behind_main="$(git -C "$worktree" rev-list --count HEAD..origin/main)"
      printf 'main delta: ahead %s, behind %s\n' "$ahead_main" "$behind_main"
    fi
  done < <(find "$lanes_root" -mindepth 1 -maxdepth 2 -type d | sort)
fi
