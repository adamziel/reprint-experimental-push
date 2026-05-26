Recovery ownership hardening pass:

- Added a fail-closed guard so production recovery journal `schemaVersion` must be an owned property, not inherited through the prototype.
- Added a regression proving inherited `schemaVersion` now fails closed with `PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED`.

Changed files:

- [`src/apply.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/apply.js)
- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/push-planner.test.js)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/.lane-output/final.md)

Commands:

- `timeout 60s node --test --test-name-pattern='production durable journal claims fail closed when schemaVersion is inherited through the prototype|production durable journal claims fail closed when journalPath is inherited through the prototype|production durable journal claims fail closed when productionAdapter is inherited through the prototype|production durable journal claims fail closed when the adapter kind is inherited through the prototype' test/push-planner.test.js`

Verification:

- Focused slice passed `4/4`.

Push result:

- Not pushed yet.

Worktree status:

- Dirty tracked files: `src/apply.js`, `test/push-planner.test.js`, `.lane-output/final.md`
- Branch is on `lane/cycle-20260525-mainwindows-2349/no-data-loss-recovery`

Next supervisor nudge:

1. Commit the schemaVersion ownership hardening and try a normal push.
2. If push is blocked by divergence, keep the commit intact and hand off the exact non-destructive push blocker.
