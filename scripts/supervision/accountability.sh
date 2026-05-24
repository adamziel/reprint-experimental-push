#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
codex_fast_model="${CODEX_FAST_MODEL:-gpt-5.4-mini}"
codex_fast_reasoning_effort="${CODEX_FAST_REASONING_EFFORT:-low}"

printf '%s\n' "supervisor accountability:"
printf 'fast mode default: model=%s reasoning=%s\n' "$codex_fast_model" "$codex_fast_reasoning_effort"

session_count="$(tmux list-sessions 2>/dev/null | sed -n '/^rp-/p' | wc -l | tr -d ' ')"
printf 'rp tmux sessions: %s\n' "$session_count"

if tmux list-panes -a -F '#{session_name}	#{pane_current_command}	#{pane_pid}' 2>/dev/null | sed -n '/^rp-/p' >/tmp/reprint-supervision-panes.$$; then
  while IFS=$'\t' read -r session command pid; do
    [ -n "$session" ] || continue
    children="$(pgrep -a -P "$pid" 2>/dev/null || true)"
    if [ -n "$children" ]; then
      printf 'active pane: %s command=%s children=%s\n' "$session" "$command" "$(printf '%s' "$children" | tr '\n' ';')"
    else
      printf 'idle pane: %s command=%s\n' "$session" "$command"
    fi
  done </tmp/reprint-supervision-panes.$$
  rm -f /tmp/reprint-supervision-panes.$$
fi

changed_files="$(
  {
    git -C "$repo" diff --name-only
    git -C "$repo" diff --cached --name-only
    git -C "$repo" ls-files --others --exclude-standard
  } | sort -u
)"

if [ -z "$changed_files" ]; then
  printf '%s\n' "main worktree drift: none"
  exit 0
fi

printf '%s\n' "main worktree drift:"
printf '%s\n' "$changed_files" | sed 's/^/  /'

non_supervisor_changes="$(
  printf '%s\n' "$changed_files" | grep -Ev '^(scripts/supervision/.*|supervision/.*|docs/supervised-lanes\.md|docs/supervisor-feedback\.md|docs/progress-log\.md|progress\.html)$' || true
)"

if [ -n "$non_supervisor_changes" ]; then
  printf '%s\n' "accountability warning: supervisor has non-supervision implementation drift in the main worktree."
  printf '%s\n' "$non_supervisor_changes" | sed 's/^/  /'
  exit 2
fi

printf '%s\n' "main worktree drift is limited to supervision/progress files."
