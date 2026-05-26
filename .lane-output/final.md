Recovery ownership hardening pass:

- Added a fail-closed guard so `writerLease` must be an owned property on production recovery journal writers, not inherited through the prototype.
- Added a regression proving inherited `writerLease` now fails closed with `PRODUCTION_DURABLE_JOURNAL_UNSUPPORTED`.

Changed files:

- [`src/apply.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/apply.js)
- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/push-planner.test.js)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/.lane-output/final.md)

Commands:

- `timeout 60s node --test --test-name-pattern='writerLease is inherited through the prototype|ownsRemoteArtifact is inherited through the prototype|artifact refs use a null prototype' test/push-planner.test.js`

Verification:

- Focused slice passed `3/3`.

Push result:

- Not pushed yet.

Worktree status:

- Dirty tracked files: `src/apply.js`, `test/push-planner.test.js`, `.lane-output/final.md`
- Branch is on `lane/cycle-20260525-mainwindows-2349/no-data-loss-recovery`

Next supervisor nudge:

1. Commit the lease-ownership hardening and try a normal push.
2. If push is blocked by divergence, keep the commit intact and hand off the exact non-destructive push blocker.
