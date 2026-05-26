Updated the critic audit to reflect the newest reliable-executor proof and the freshness-only progress refresh without widening the production claim.

Changed files:
- [`audits/critic.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/critic/audits/critic.md)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/critic/.lane-output/final.md)

What changed:
- Kept the verdict at `0/4`.
- Updated the reliable-executor summary to say the release verifier now fails closed with a visible `HTTP 502` readiness trail instead of hanging silently.
- Noted that the public progress refresh was freshness-only and did not move the gate posture.

Commands:
- `sed -n '1,240p' ../reliable-executor/.lane-output/final-loop-20260526-044044.md`
- `sed -n '1,240p' ../progress-publisher/.lane-output/final-loop-20260526-044325.md`
- `sed -n '1,240p' ../independent-auditor/.lane-output/final.md`
- `sed -n '1,240p' audits/critic.md`
- `git diff -- audits/critic.md .lane-output/final.md`

Push result:
- Not run

Worktree status:
- Branch: `lane/cycle-20260525-mainwindows-2349/critic`
- `HEAD`: `fa0dc8a0`
- `origin/lane/critic`: `5b61693d`
- Dirty tracked files: `audits/critic.md`, `.lane-output/final.md`

Next supervisor nudge:
- Re-poll `reliable-executor` only when it lands a concrete proof delta that changes the release-gate verdict, especially exact replay-equivalence evidence or a production-backed auth/journal path.
