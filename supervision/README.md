# Supervised Tmux Workflow

The project uses one lane per priority item, plus an auditor, a critic, and a
progress publisher. Each lane works in its own Git worktree and branch so
parallel sessions do not overwrite each other.

## Lanes

| Lane | Priority | Primary ownership |
| --- | --- | --- |
| `no-data-loss-invariants` | No data loss | Merge invariants, conflict classes, scenario tests |
| `no-data-loss-recovery` | No data loss | Apply journals, rollback, crash/failpoint tests |
| `reliable-executor` | Reliable | Protocol and executor design for real WordPress sites |
| `fast-paths` | Fast | Chunking, hashing, batching, benchmark design |
| `independent-auditor` | Audit | Evidence checks against the objective |
| `critic` | Critique | High-bar review across all design sessions |
| `feedback-supervisor` | Feedback | Supervisor nudges, progress deltas, concise status updates |
| `progress-publisher` | Visibility | `progress.html`, progress log, GitHub Pages readiness |

## Commands

Start or resume all lanes:

```bash
scripts/supervision/start-lanes.sh
```

Start or resume only the feedback supervisor session:

```bash
scripts/supervision/start-feedback-session.sh
```

Check sessions and branch state:

```bash
scripts/supervision/status.sh
```

The scripts create worktrees under
`$REPRINT_PUSH_LANES_DIR` or `~/reprint-experimental-push-lanes`.
Clean existing worktrees are fast-forwarded to `origin/main` before a new
session starts. Dirty or diverged worktrees are reported and left untouched.

## Auditing Active Work

Use these commands from the main worktree:

```bash
scripts/supervision/status.sh
tmux capture-pane -pt rp-feedback-supervisor:0 -S -120
tmux attach -t rp-feedback-supervisor
git -C ~/reprint-experimental-push-lanes/feedback-supervisor status --short --branch
```

Each lane writes its final report to `.lane-output/final.md` inside that lane's
worktree. A live tmux session means work is still in progress; a clean worktree
with a pushed branch and no tmux session means the lane has finished its current
assignment.

## Lane Rules

- Stay on the assigned lane branch.
- Do not edit another lane's owned files unless the prompt explicitly allows it.
- Push finished lane work to the remote branch.
- Leave the worktree clean after pushing.
- The feedback lane should keep a short "what changed / what is stuck / next
  nudge" record and make sure `progress.html` has a visible last-updated date.
- Do not use remote tunnel services. Use only local processes and the sandbox
  8080 ingress if a browser preview is needed.
- Do not add generated-by attribution or agent labels to commits, branches, PRs,
  or comments.
