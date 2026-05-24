#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
lanes_root="${REPRINT_PUSH_LANES_DIR:-"$HOME/reprint-experimental-push-lanes"}"
cycle="${1:-"cycle-$(date +%Y%m%d-%H%M%S)"}"
base_ref="${REPRINT_PUSH_LANE_BASE:-origin/main}"
tmux_socket_dir="${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)"

lanes=(
  no-data-loss-invariants
  no-data-loss-recovery
  reliable-executor
  fast-paths
  independent-auditor
  critic
  feedback-supervisor
  progress-publisher
)

mkdir -p "$lanes_root/$cycle"
mkdir -p "$tmux_socket_dir"
chmod 700 "$tmux_socket_dir"

git -C "$repo" fetch --quiet origin main

for lane in "${lanes[@]}"; do
  worktree="$lanes_root/$cycle/$lane"
  branch="lane/$cycle/$lane"
  session="rp-${cycle}-${lane}"
  prompt="$repo/supervision/lanes/$lane.md"
  output="$worktree/.lane-output/final.md"

  if tmux has-session -t "$session" 2>/dev/null; then
    printf '%s\n' "session exists: $session"
    continue
  fi

  if [ ! -f "$prompt" ]; then
    printf '%s\n' "missing lane prompt: $prompt" >&2
    continue
  fi

  if ! git -C "$worktree" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if git -C "$repo" show-ref --verify --quiet "refs/heads/$branch"; then
      git -C "$repo" worktree add "$worktree" "$branch"
    else
      git -C "$repo" worktree add -b "$branch" "$worktree" "$base_ref"
    fi
  elif ! git -C "$worktree" diff --quiet || ! git -C "$worktree" diff --cached --quiet; then
    printf '%s\n' "worktree has local changes; not starting: $worktree"
    continue
  fi

  mkdir -p "$worktree/.lane-output"

  tmux new-session -d -s "$session" \
    "cd '$worktree' && codex exec -C '$worktree' --dangerously-bypass-approvals-and-sandbox -o '$output' - < '$prompt'; printf '\n[lane finished: $lane]\n'; git status --short --branch; exec bash"
  printf '%s\n' "started: $session -> $worktree"
done

