Refreshed the public progress surface so the visible timestamp and newest-audit link stay current with the active supervision cycle.

Changed files:
- [progress.html](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/progress-publisher/progress.html)
- [docs/progress-log.md](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/progress-publisher/docs/progress-log.md)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/progress-publisher/.lane-output/final.md)

Commands:
- `date '+%Y-%m-%d %H:%M:%S %Z'`
- `rg -n "Last updated|Newest audit|02:58:56|025856" progress.html docs/progress-log.md`
- `sed -n '1,40p' docs/progress-log.md`
- `sed -n '498,520p' progress.html`
- `git diff -- progress.html docs/progress-log.md && git status --short --branch`

Push result:
- Not yet pushed

Worktree status:
- Tracked files are dirty for the freshness republish
- Branch: `lane/cycle-20260525-mainwindows-2349/progress-followup`
- Current branch remains `ahead 106, behind 23` relative to `origin/main`

Next supervisor nudge:
- Republish again only when the visible `Last updated` stamp falls behind the active supervision cycle, or when a real gate verdict changes.
