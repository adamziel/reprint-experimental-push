No Data Loss Recovery handoff:

- Timestamp: 2026-05-26 18:21:30 CEST (+0200)
- This pass closes a persisted-history gap in production durable-journal support checks.
- `productionRecoverySupportReport()` and `durableJournalPersistedArtifactRefs()` now fail closed when non-empty persisted artifact-ref history silently drops the journal ref or owned remote ref mid-run, instead of only rejecting rewritten paths.
- `test/push-planner.test.js` now proves both new blocked-recovery cases and keeps the adjacent rewritten-history cases green.

Changed files:

- [src/apply.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/apply.js)
- [test/push-planner.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/push-planner.test.js)
- [.lane-output/final.md](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/.lane-output/final.md)

Commands:

- `git status --short --branch`
- `sed -n '1,220p' AGENTS.md`
- `sed -n '1,220p' supervision/README.md`
- `sed -n '1,220p' supervision/lanes/no-data-loss-recovery.md`
- targeted `sed`/`grep` reads in `src/apply.js`, `src/recovery-journal.js`, `test/recovery-journal.test.js`, and `test/push-planner.test.js`
- `timeout 120s node --test --test-name-pattern='production durable journal partial commits fail closed when persisted (journal history rewrites to a different absolute path|journal history drops the journal artifact ref|remote artifact history rewrites to a different absolute path|remote artifact history drops the remote artifact ref) mid-run' test/push-planner.test.js`
- `git diff --check -- src/apply.js test/push-planner.test.js`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`

Push result:

- `81876407..59224932  HEAD -> lane/no-data-loss-recovery`

Worktree status:

- Clean on `lane/no-data-loss-recovery-work...origin/lane/no-data-loss-recovery`
- HEAD: `592249320b20a00d95caed5e860872dc20778fdf`

Next supervisor nudge:

1. `main:reliable-exec` can now treat mixed persisted artifact-ref history as unsupported production durability, not just rewritten paths. The remaining release gate work is still reliable-owned unless the checked release path exposes another recovery-side gap in owned durable records or restart-readable artifacts.
