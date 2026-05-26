No Data Loss Recovery handoff:

- Timestamp: 2026-05-26 18:23:59 CEST (+0200)
- This pass closes a persisted-history collapse gap in production durable-journal support checks.
- `durableJournalPersistedArtifactRefs()` now fails closed when persisted remote-artifact history converges onto the journal path across records, instead of only rejecting the same collapse when it is visible in one advertised snapshot.
- `test/push-planner.test.js` now proves that persisted remote-artifact history collapsing to the journal path blocks recovery-state recording just like the adjacent rewritten and missing persisted-history cases.

Changed files:

- [src/apply.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/apply.js)
- [test/push-planner.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/push-planner.test.js)
- [.lane-output/final.md](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/.lane-output/final.md)

Commands:

- `git status --short --branch`
- `sed -n '1,220p' AGENTS.md`
- `sed -n '1,220p' supervision/README.md`
- `sed -n '1,240p' supervision/lanes/no-data-loss-recovery.md`
- targeted `sed`/`grep` reads in `src/apply.js`, `src/recovery-journal.js`, and `test/push-planner.test.js`
- `timeout 120s node --test --test-name-pattern='production durable journal partial commits fail closed when persisted remote artifact history (rewrites to a different absolute path|collapses to the journal path|drops the remote artifact ref) mid-run' test/push-planner.test.js`
- `git diff --check -- src/apply.js test/push-planner.test.js`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`

Push result:

- Pending in this pass.

Worktree status:

- Dirty on `lane/no-data-loss-recovery-work...origin/lane/no-data-loss-recovery` until commit/push.

Next supervisor nudge:

1. `main:reliable-exec` can now treat persisted remote-artifact history that converges onto the journal path as unsupported production durability, not just same-snapshot collapse, rewrites, or dropped refs. The remaining release gate work stays reliable-owned unless the checked release path exposes another recovery-side mismatch in owned durable records or restart-readable artifacts.
