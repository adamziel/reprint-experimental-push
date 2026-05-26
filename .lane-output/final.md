Recovery hardening pass:

- Required restart-readability to be owned directly on production recovery journal writers before the support probe will treat them as fenced/leased.
- Added a regression that fails closed when restart readability is inherited through the prototype instead of owned directly.

Changed files:

- [`src/apply.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/apply.js)
- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/push-planner.test.js)

Commands:

- `timeout 60s node --test --test-name-pattern 'restart readability is inherited through the prototype|the adapter marker is inherited through the prototype' test/push-planner.test.js`

Verification:

- Focused slice passed `2/2`.

Push result:

- Not pushed yet.

Worktree status:

- Dirty tracked files: `src/apply.js`, `test/push-planner.test.js`, `.lane-output/final.md`
- Branch is `ahead 702, behind 269` relative to `origin/main`

Next supervisor nudge:

1. Commit this recovery-ownership hardening and try a normal push.
2. If push is blocked by divergence, keep the commit intact and hand off the exact non-destructive merge/rebase command needed next.
