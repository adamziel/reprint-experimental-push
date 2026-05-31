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
codex_fast_model="${CODEX_FAST_MODEL:-gpt-5.5}"
codex_fast_reasoning_effort="${CODEX_FAST_REASONING_EFFORT:-xhigh}"

mkdir -p "$lanes_root"
mkdir -p "$tmux_socket_dir"
chmod 700 "$tmux_socket_dir"
git -C "$repo" fetch --quiet origin main

start_fresh_session() {
  suffix="refresh-$(date +%Y%m%d-%H%M%S)"
  worktree="$lanes_root/$lane-$suffix"
  branch="lane/$lane-$suffix"
  session="rp-$lane-$suffix"
  output="$worktree/.lane-output/final.md"

  if tmux has-session -t "$session" 2>/dev/null; then
    printf '%s\n' "session exists: $session"
    exit 0
  fi

  git -C "$repo" worktree add -b "$branch" "$worktree" origin/main
}

if tmux has-session -t "$session" 2>/dev/null; then
  printf '%s\n' "session exists: $session"
  exit 0
fi

if ! git -C "$worktree" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$repo" worktree add -B "$branch" "$worktree" HEAD
elif git -C "$worktree" diff --quiet && git -C "$worktree" diff --cached --quiet; then
  if git -C "$worktree" merge-base --is-ancestor HEAD origin/main; then
    git -C "$worktree" merge --ff-only origin/main >/dev/null
  else
    printf '%s\n' "worktree has clean local commits; starting fresh feedback session instead: $worktree"
    start_fresh_session
  fi
else
  printf '%s\n' "worktree has local changes; starting fresh feedback session instead: $worktree"
  start_fresh_session
fi

mkdir -p "$worktree/.lane-output"

tmux new-session -d -s "$session" \
  "cd '$worktree' && codex exec -m '$codex_fast_model' -c 'model_reasoning_effort=\"$codex_fast_reasoning_effort\"' -C '$worktree' --dangerously-bypass-approvals-and-sandbox -o '$output' - < '$prompt'; printf '\n[lane finished: $lane]\n'; git status --short --branch; exec bash"
printf '%s\n' "started: $session -> $worktree"
printf '%s\n' "fast mode: model=$codex_fast_model reasoning=$codex_fast_reasoning_effort"
