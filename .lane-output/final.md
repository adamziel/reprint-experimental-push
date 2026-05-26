Changed files:
- [`src/apply.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/apply.js)
- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/push-planner.test.js)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/.lane-output/final.md)

What changed:
- Tightened the durable-journal recovery boundary so restart-readable claims now require explicit adapter ownership plus matching artifact references and schema.
- Added regressions for missing, non-absolute, mismatched, and divergent artifact references.

Commands run:
- `timeout 120s node --test test/push-planner.test.js -t 'replaying a completed plan stays fully updated and does not duplicate durable replay records' -t 'durable recovery contract keeps failure-before-mutation, failure-after-staging, failure-after-dependency-validation, and completed replay inside the approved states'`
- `timeout 120s node --test test/push-planner.test.js -t 'production durable journal claims fail closed when the writer artifact reference diverges from restart inspection' -t 'production durable journal claims fail closed when restart inspection reports a non-absolute file path' -t 'production durable journal claims fail closed when restart inspection lacks a journal location'`

Verification:
- The targeted recovery checks passed.
- The full `test/push-planner.test.js` run passed `452/452`.

Push result:
- Not pushed yet.

Worktree status:
- Dirty tracked files remain in `src/apply.js`, `test/push-planner.test.js`, and `.lane-output/final.md`
- Branch is ahead of `origin/main` and still diverged

Next supervisor nudge:
1. Keep the durable journal surface fail-closed unless a real restart-readable backend is added here.
2. If broader replay cleanup is desired, route it as a separate pass so it does not widen the supported durability claim.
