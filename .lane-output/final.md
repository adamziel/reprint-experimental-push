Recovery ownership hardening pass:

- Added a regression for prototype-inherited remote artifact ownership on the production recovery journal boundary.
- Tightened existing assertions in the recovery-adapter tests so they verify the actual fail-closed dependencies instead of overfitting to one diagnostic order.

Changed files:

- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/push-planner.test.js)

Commands:

- `timeout 60s node --test --test-name-pattern 'prototype|remote artifact ownership' test/push-planner.test.js`

Verification:

- Focused slice passed `25/25`.

Push result:

- Not pushed yet.

Worktree status:

- Dirty tracked files: `test/push-planner.test.js`, `.lane-output/final.md`
- Branch was clean before this pass and is still on `lane/cycle-20260525-mainwindows-2349/no-data-loss-recovery`

Next supervisor nudge:

1. Commit the recovery ownership hardening and try a normal push.
2. If push is blocked by divergence, keep the commit intact and hand off the exact non-destructive merge/rebase command needed next.
