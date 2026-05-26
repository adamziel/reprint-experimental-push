No Data Loss Recovery handoff:

- Timestamp: 2026-05-27 00:26:26 CEST (+0200)
- Branch head before commit: `d44fc2dc53777d813aafe5f5281901b1c4a1bdf4` (`Cover inherited consumed claim lease drift`)
- This pass tightened the recovery-owned consumed-claim summary contract instead of adding another support-only variant. [src/recovery-journal.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/recovery-journal.js) now returns `null` for malformed `recovery-journal-consumed` summaries instead of surfacing partially populated objects with null fields.
- [test/recovery-journal.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/recovery-journal.test.js) now proves reopen fails closed when a persisted consumed claim omits `claimHash`, and asserts the error details expose `consumedClaim: null`.
- [test/push-planner.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/push-planner.test.js) now proves `productionRecoverySupportReport()` rejects a partial consumed summary that omits `claimHash` on the apply-side checked-path report.

Changed files:

- [src/recovery-journal.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/recovery-journal.js)
- [test/recovery-journal.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/recovery-journal.test.js)
- [test/push-planner.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/push-planner.test.js)
- [.lane-output/final.md](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/.lane-output/final.md)

Commands:

- `git status --short --branch`
- `git log --oneline --decorate -n 12 -- src/apply.js src/recovery-journal.js test/push-planner.test.js test/recovery-journal.test.js scripts/recovery`
- `grep -RIn "consumed.*claim\\|claim.*consumed\\|staleClaimRejected\\|classifyRecoveryJournalClaims\\|claim-fence\\|hash drift" src test scripts`
- `sed -n '1428,1488p' src/apply.js`
- `sed -n '2038,2078p' src/recovery-journal.js`
- `sed -n '1060,1145p' test/recovery-journal.test.js`
- `sed -n '22060,22540p' test/push-planner.test.js`
- `git diff --check`
- `timeout 120s node --test test/recovery-journal.test.js --test-name-pattern='persisted consumed claim omits its hash identity'`
- `timeout 120s node --input-type=module ... productionRecoverySupportReport missing-hash guard`

Push result:

- Pending commit/push for this pass at handoff file write time.

Worktree status:

- Modified tracked files are limited to this lane-owned recovery change set and this handoff file.

Next supervisor nudge:

- Reliable should treat partial consumed-claim summaries as closed evidence gaps now: recovery reopen and apply-side support reporting both fail closed when consumed identity is incomplete. The next gate-moving work is still reliable-owned production auth/session lifecycle or release-path durable-journal consumption, not another local consumed-summary variant.
