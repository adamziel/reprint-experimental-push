Refreshed the public progress surface for newer critic and no-data-loss-invariants evidence, then aligned the progress log and header links to the same audit.

Changed files:
- [`progress.html`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/progress-publisher/progress.html)
- [`docs/progress-log.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/progress-publisher/docs/progress-log.md)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/progress-publisher/.lane-output/final.md)

Commands run:
- `git fetch --all --prune --quiet && git for-each-ref --format='%(refname:short) %(objectname:short) %(subject)' refs/remotes/origin/lane/reliable-executor refs/remotes/origin/lane/no-data-loss-recovery refs/remotes/origin/lane/no-data-loss-invariants refs/remotes/origin/lane/fast-paths refs/remotes/origin/lane/same-plan-wordpress-graph-create refs/remotes/origin/lane/progress-publisher refs/remotes/origin/lane/independent-auditor refs/remotes/origin/lane/critic refs/remotes/origin/lane/feedback-supervisor refs/remotes/origin/main`
- `git status --short --branch && printf '\n--- progress.html ---\n' && rg -n 'Last updated|Gate status|verified|pending|blocked|evidence|release blockers|latest public audit' progress.html docs/progress-log.md docs/supervisor-feedback.md && printf '\n--- newest log ---\n' && sed -n '1,80p' docs/progress-log.md`
- `git show --stat --oneline --decorate --summary origin/lane/critic --`
- `git show --stat --oneline --decorate --summary origin/lane/no-data-loss-invariants --`
- `date '+%Y-%m-%d %H:%M:%S %Z'`
- `git diff -- progress.html docs/progress-log.md && git status --short --branch`

Push result:
- Not yet pushed

Worktree status:
- Dirty with tracked edits in `progress.html`, `docs/progress-log.md`, and `.lane-output/final.md`
- Branch: `lane/cycle-20260525-mainwindows-2349/progress-followup`
- Ahead of `origin/main` by 17 commits

Next supervisor nudge:
- Re-poll only after `reliable-executor`, `no-data-loss-recovery`, or `no-data-loss-invariants` publishes a newer executable proof; otherwise keep `progress.html` and `docs/progress-log.md` frozen.
