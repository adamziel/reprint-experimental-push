Updated the objective audit for the newest visible heads in `progress-followup` and `no-data-loss-invariants`, while keeping the release verdict at `0/4`.

Changed files:
- [`audits/objective-audit.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/independent-auditor/audits/objective-audit.md)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/independent-auditor/.lane-output/final.md)

Commands run:
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`
- `git for-each-ref --format='%(refname:short) %(objectname:short) %(subject)' refs/remotes/origin/lane/cycle-20260525-mainwindows-2349/{feedback-supervisor,progress-followup,independent-auditor} refs/remotes/origin/lane/{reliable-executor,no-data-loss-invariants,no-data-loss-recovery} 2>/dev/null | sort`
- `sed -n '56,96p' audits/objective-audit.md`
- `git diff -- audits/objective-audit.md`
- `git status --short --branch`

Push result:
- Not run yet this pass

Worktree status:
- Branch remains ahead of `origin/main` with no new tracked-file changes beyond the audit refresh

Next supervisor nudge:
- Re-poll only when production-backed auth/session or durable-journal proof changes the release boundary; the audit still supports `0/4`.
