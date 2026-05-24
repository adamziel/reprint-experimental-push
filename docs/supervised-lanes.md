# Supervised Lane Audit

This project uses tmux sessions and Git worktrees to keep the push-back design
work split by priority. The current cycle is the source of truth for in-flight
work; older lane branches remain available as history.

## Current Status

Run:

```bash
scripts/supervision/status.sh
```

Read it in this order:

1. `tmux sessions` shows active lanes. A missing `rp-...` session means that
   lane is not currently running.
2. `worktrees` shows each lane checkout and branch.
3. `lane git state` shows whether a lane has committed work ahead of
   `origin/main`, is behind `origin/main`, or has uncommitted changes.

## Active Cycle

Start a fresh supervised cycle from current `origin/main`:

```bash
scripts/supervision/start-cycle.sh cycle-YYYYMMDD-label
```

For this cycle, the session names and worktrees are:

| Lane | Session | Worktree |
| --- | --- | --- |
| No data loss invariants | `rp-cycle-20260524-followup-no-data-loss-invariants` | `~/reprint-experimental-push-lanes/cycle-20260524-followup/no-data-loss-invariants` |
| No data loss recovery | `rp-cycle-20260524-followup-no-data-loss-recovery` | `~/reprint-experimental-push-lanes/cycle-20260524-followup/no-data-loss-recovery` |
| Reliable executor | `rp-cycle-20260524-followup-reliable-executor` | `~/reprint-experimental-push-lanes/cycle-20260524-followup/reliable-executor` |
| Fast paths | `rp-cycle-20260524-followup-fast-paths` | `~/reprint-experimental-push-lanes/cycle-20260524-followup/fast-paths` |
| Independent auditor | `rp-cycle-20260524-followup-independent-auditor` | `~/reprint-experimental-push-lanes/cycle-20260524-followup/independent-auditor` |
| Critic | `rp-cycle-20260524-followup-critic` | `~/reprint-experimental-push-lanes/cycle-20260524-followup/critic` |
| Feedback supervisor | `rp-cycle-20260524-followup-feedback-supervisor` | `~/reprint-experimental-push-lanes/cycle-20260524-followup/feedback-supervisor` |
| Progress publisher | `rp-cycle-20260524-followup-progress-publisher` | `~/reprint-experimental-push-lanes/cycle-20260524-followup/progress-publisher` |

Attach to a lane:

```bash
tmux attach -t rp-cycle-20260524-followup-reliable-executor
```

Detach without stopping it: press `Ctrl-b`, then `d`.

## Finished Lane Audit

Each lane writes its final note to:

```bash
~/reprint-experimental-push-lanes/<cycle>/<lane>/.lane-output/final.md
```

After a lane finishes, inspect:

```bash
lane=~/reprint-experimental-push-lanes/cycle-20260524-followup/reliable-executor
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
reuse clean worktrees, skip dirty worktrees, and leave old branches untouched:

```bash
scripts/supervision/start-cycle.sh cycle-20260524-followup
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

