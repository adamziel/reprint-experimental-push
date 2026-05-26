Updated the public freshness surface and kept the gate posture at `0/4`.

Changed files:
- [`progress.html`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/progress-publisher/progress.html)
- [`docs/progress-log.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/progress-publisher/docs/progress-log.md)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/progress-publisher/.lane-output/final.md)

Commands:
- `date '+%Y-%m-%d %H:%M:%S %Z'`
- `rg -n "Last updated|Newest audit|Open newest audit|Gate status|0/4|blocker|Freshness update only|Current status" progress.html docs/progress-log.md`
- `sed -n '500,520p' progress.html`
- `sed -n '1,24p' docs/progress-log.md`
- `git diff -- progress.html docs/progress-log.md .lane-output/final.md | sed -n '1,240p'`

Push result:
- Pending

Worktree status:
- Modified: `.lane-output/final.md`, `docs/progress-log.md`, `progress.html`
- Branch: `lane/cycle-20260525-mainwindows-2349/progress-followup`
- Relative to `origin/main`: `ahead 307, behind 97`

Next supervisor nudge:
- Republish only when the visible freshness stamp falls behind the active supervision cycle again, or when a real gate verdict changes.
