Refined the critic audit to reflect the newest recovery hardening without changing the production verdict.

Changed files:
- [`audits/critic.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/critic/audits/critic.md)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/critic/.lane-output/final.md)

What changed:
- Noted that recovery now fail-closes malformed artifact envelopes before symbol-key inspection.
- Added the narrower nested symbol-key leakage boundary in preserved recovery artifacts.
- Kept the blocker set unchanged: production auth/session lifecycle, durable journal ownership, preserved-remote retry, and exact replay equivalence are still unproven.

Evidence checked:
- `git status --short --branch`
- `sed -n '1,260p' audits/critic.md`
- latest `../reliable-executor/.lane-output/final*.md`
- latest `../no-data-loss-recovery/.lane-output/final*.md`

Push result:
- Not pushed yet.

Worktree status:
- `lane/cycle-20260525-mainwindows-2349/critic...origin/main [ahead 1568, behind 377]`
- Dirty tracked files: `audits/critic.md`, `.lane-output/final.md`

Next supervisor nudge:
- Re-poll `reliable-executor` only when it lands exact replay-equivalence or a production-backed mutation path, or `no-data-loss-recovery` only when it proves preserved-remote retry with lease/fencing and restart-readable artifacts.
