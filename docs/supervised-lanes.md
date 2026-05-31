# Supervised Lane Audit

This project uses tmux sessions and Git worktrees to keep the push-back design
work split by priority. The current cycle is the source of truth for in-flight
work; older lane branches remain available as history.

## Current Status

Run:

```bash
scripts/supervision/status.sh
```

Run the accountability check when taking over supervision:

```bash
scripts/supervision/accountability.sh
```

Read it in this order:

1. `tmux sessions` shows active lanes. A missing `rp-...` session means that
   lane is not currently running.
2. `worktrees` shows each lane checkout and branch.
3. `lane git state` shows whether a lane has committed work ahead of
   `origin/main`, is behind `origin/main`, or has uncommitted changes.
4. `accountability.sh` reports active/idle `rp-*` panes, the fast-mode worker
   defaults, and whether the main worktree has non-supervision implementation
   drift.

## Active Cycle

Start a fresh supervised cycle from current `origin/main`:

```bash
scripts/supervision/start-cycle.sh cycle-YYYYMMDD-label
```

Lane launchers use GPT-5.5 with high-reasoning defaults:

```bash
CODEX_FAST_MODEL=gpt-5.5
CODEX_FAST_REASONING_EFFORT=xhigh
```

Override those environment variables only when a lane genuinely needs a
different model. The supervisor should keep feature work in lanes; if
`accountability.sh` reports non-supervision drift in `main`, stop local
development and delegate that change to a worker lane.

Start just the feedback supervisor:

```bash
scripts/supervision/start-feedback-session.sh
```

If the default feedback worktree has stale local commits or local changes, the
script leaves it untouched and starts a fresh suffixed feedback session from
current `origin/main`.

The feedback supervisor is part of every full cycle and can also be started on
its own. Its job is to update `docs/supervisor-feedback.md`,
`docs/progress-log.md`, and `progress.html` with a dated, concise nudge after
material evidence changes.

For the current cycle, the session names and worktrees are:

| Lane | Session | Worktree |
| --- | --- | --- |
| No data loss invariants | `rp-cycle-20260524-auth-graph-hardening-no-data-loss-invariants` | `~/reprint-experimental-push-lanes/cycle-20260524-auth-graph-hardening/no-data-loss-invariants` |
| No data loss recovery | `rp-cycle-20260524-auth-graph-hardening-no-data-loss-recovery` | `~/reprint-experimental-push-lanes/cycle-20260524-auth-graph-hardening/no-data-loss-recovery` |
| Reliable executor | `rp-cycle-20260524-auth-graph-hardening-reliable-executor` | `~/reprint-experimental-push-lanes/cycle-20260524-auth-graph-hardening/reliable-executor` |
| Fast paths | `rp-cycle-20260524-auth-graph-hardening-fast-paths` | `~/reprint-experimental-push-lanes/cycle-20260524-auth-graph-hardening/fast-paths` |
| Independent auditor | `rp-cycle-20260524-auth-graph-hardening-independent-auditor` | `~/reprint-experimental-push-lanes/cycle-20260524-auth-graph-hardening/independent-auditor` |
| Critic | `rp-cycle-20260524-auth-graph-hardening-critic` | `~/reprint-experimental-push-lanes/cycle-20260524-auth-graph-hardening/critic` |
| Feedback supervisor | `rp-cycle-20260524-auth-graph-hardening-feedback-supervisor` | `~/reprint-experimental-push-lanes/cycle-20260524-auth-graph-hardening/feedback-supervisor` |
| Progress publisher | `rp-cycle-20260524-auth-graph-hardening-progress-publisher` | `~/reprint-experimental-push-lanes/cycle-20260524-auth-graph-hardening/progress-publisher` |

Attach to a lane:

```bash
tmux attach -t rp-cycle-20260524-auth-graph-hardening-reliable-executor
```

Detach without stopping it: press `Ctrl-b`, then `d`.

## Finished Lane Audit

Each lane writes its final note to:

```bash
~/reprint-experimental-push-lanes/<cycle>/<lane>/.lane-output/final.md
```

After a lane finishes, inspect:

```bash
lane=~/reprint-experimental-push-lanes/cycle-20260524-auth-graph-hardening/reliable-executor
git -C "$lane" status --short --branch
git -C "$lane" log --oneline --decorate -5
sed -n '1,220p' "$lane/.lane-output/final.md"
```

If the lane produced committed work, verify its tests, push the branch, and
merge or cherry-pick only after reviewing the diff:

```bash
git -C "$lane" diff --stat origin/main...HEAD
git -C "$lane" push -u origin HEAD
```

If a lane died before finishing, restart the same cycle. The launcher will
reuse clean worktrees, fast-forward lanes that are behind `origin/main`, skip
dirty worktrees, and skip clean stale branches with local commits. Inspect or
archive stale lane commits before starting a new session from them:

```bash
scripts/supervision/start-cycle.sh cycle-YYYYMMDD-label
```

## Public Progress

The public progress page is:

<https://adamziel.github.io/reprint-experimental-push/progress.html>

Verify the deployed copy after publishing:

```bash
curl -fsSL -H 'Cache-Control: no-cache' \
  'https://adamziel.github.io/reprint-experimental-push/progress.html?audit' |
  rg 'Last updated:|Supervisor Feedback|Production push'
```

The page must stay concise. Detailed evidence belongs in Markdown docs linked
from the page.
