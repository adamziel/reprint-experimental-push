No Data Loss Recovery handoff:

- Timestamp: 2026-05-26 18:40:03 CEST (+0200)
- This pass closes a restart-readable history gap where explicit record-level `artifactRefs` containers could be silently ignored if they were non-plain objects.
- `persistedProductionArtifactRefs()` and `durableJournalPersistedArtifactRefs()` now fail closed when a record explicitly carries `artifactRefs` but does not persist them as a strict plain object, instead of skipping that record and accepting the older ownership history.
- Focused regressions now prove both surfaces reject array-shaped record-level artifact refs: the file-backed production journal reopen path and the apply-side inspected durable-journal support probe.

Changed files:

- [src/recovery-journal.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/recovery-journal.js)
- [src/apply.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/apply.js)
- [test/recovery-journal.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/recovery-journal.test.js)
- [test/push-planner.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/push-planner.test.js)

Commands:

- `git status --short --branch`
- targeted `sed`/`grep` reads in `src/recovery-journal.js`, `src/apply.js`, `test/recovery-journal.test.js`, and `test/push-planner.test.js`
- `timeout 120s node --test --test-name-pattern='production recovery journal adapter fails closed when persisted records use non-plain artifact refs' test/recovery-journal.test.js`
- `timeout 120s node --test --test-name-pattern='production durable journal claims fail closed when persisted inspected artifact refs are array-shaped' test/push-planner.test.js`
- `git diff --check -- src/recovery-journal.js src/apply.js test/recovery-journal.test.js test/push-planner.test.js`

Push result:

- Pending in this pass.

Worktree status:

- Dirty on `lane/no-data-loss-recovery-work...origin/lane/no-data-loss-recovery` until commit/push.

Next supervisor nudge:

1. `main:reliable-exec` can now rely on restart-readable durable-journal history rejecting explicit non-plain record-level artifact-ref containers, not only rewritten, collapsed, dropped, or widened refs. The remaining gate work stays reliable-owned unless the checked release path exposes another recovery-side storage mismatch.
