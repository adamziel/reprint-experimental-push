Recovery hardening pass:

- Required an explicit own `assertCurrentClaim` on production recovery journal writers before the support probe will treat them as fenced/leased.
- Added a regression that fails closed when claim fencing is inherited through the prototype instead of owned directly.
- Re-ran a focused proof slice with an outer timeout; it passed.

Changed files:

- [`src/apply.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/apply.js)
- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/push-planner.test.js)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/.lane-output/final.md)

Commands:

- `timeout 60s node --test --test-name-pattern 'claim fencing is inherited through the prototype|inspection data is advertised through the prototype|restart inspection only once' test/push-planner.test.js`

Verification:

- Focused slice passed `3/3`.

Push result:

- Not pushed yet.

Worktree status:

- Dirty tracked files: `src/apply.js`, `test/push-planner.test.js`, `.lane-output/final.md`
- Branch is `ahead 694, behind 258` relative to `origin/main`

Next supervisor nudge:

1. Commit this recovery-ownership hardening and try a normal push.
2. If push is blocked by divergence, keep the commit intact and hand off the exact non-destructive merge/rebase command needed next.
