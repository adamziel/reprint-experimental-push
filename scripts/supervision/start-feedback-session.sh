#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
lanes_root="${REPRINT_PUSH_LANES_DIR:-"$HOME/reprint-experimental-push-lanes"}"
lane="feedback-supervisor"
worktree="$lanes_root/$lane"
branch="lane/$lane"
session="rp-$lane"
prompt="$repo/supervision/lanes/$lane.md"
output="$worktree/.lane-output/final.md"
tmux_socket_dir="${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)"

mkdir -p "$lanes_root"
mkdir -p "$tmux_socket_dir"
chmod 700 "$tmux_socket_dir"

if tmux has-session -t "$session" 2>/dev/null; then
  printf '%s\n' "session exists: $session"
  exit 0
fi

if ! git -C "$worktree" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$repo" worktree add -B "$branch" "$worktree" HEAD
elif git -C "$worktree" diff --quiet && git -C "$worktree" diff --cached --quiet; then
  git -C "$worktree" fetch --quiet origin main
  if ! git -C "$worktree" merge --ff-only origin/main >/dev/null; then
    printf '%s\n' "worktree not fast-forwarded: $worktree"
  fi
else
  printf '%s\n' "worktree has local changes; not fast-forwarding: $worktree"
fi

mkdir -p "$worktree/.lane-output"

tmux new-session -d -s "$session" \
  "cd '$worktree' && codex exec -C '$worktree' --dangerously-bypass-approvals-and-sandbox -o '$output' - < '$prompt'; printf '\n[lane finished: $lane]\n'; git status --short --branch; exec bash"
printf '%s\n' "started: $session -> $worktree"
