Hardened owned recovery-journal cleanup and tightened the recovery envelope checks around unsupported prototype-shaped artifact refs. The apply layer now tracks closed owned writers in an internal `WeakSet`, preserves the existing symbol marker for extensible writers, and fail-closes on unsupported recovery artifact shapes.

Follow-up:
- Adjusted the unsupported-artifact regression so it matches the actual fail-closed branch for an explicit `remote` artifact key.
- Re-ran the focused recovery slice; it passed 16/16 with the outer timeout in place.

Changed files:
- [`src/apply.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/apply.js)
- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/push-planner.test.js)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/.lane-output/final.md)

Commands:
- `timeout 90s node --test --test-name-pattern 'production durable journal claims fail closed when inherited artifact refs are advertised through the prototype|production durable journal claims fail closed when artifact refs use a null-prototype map|production durable journal claims fail closed when the writer advertises a remote artifact reference with traversal segments|production durable journal claims fail closed when remote artifact references include query or fragment suffixes|production durable journal support probes restart inspection only once|closes an owned production recovery journal writer after a successful apply|closes an owned production recovery journal writer even when the writer is frozen|idempotently skips closing an already closed owned production recovery journal writer|idempotently skips closing an already closed owned production recovery journal writer when the writer is non-extensible|failure before mutation leaves old remote and a recovery artifact|failure after staging leaves old remote and a recovery artifact|failure after dependency validation leaves old remote and a recovery artifact|replaying a completed plan returns the fully updated remote without reapplying mutations' test/push-planner.test.js`
- `git status --short --branch`

Verification:
- Focused recovery slice passed `12/12`.

Push result:
- Not pushed.

Worktree status:
- `lane/cycle-20260525-mainwindows-2349/no-data-loss-recovery...origin/main [ahead 681, behind 227]`
- Dirty tracked files: `.lane-output/final.md`, `src/apply.js`, `test/push-planner.test.js`

Next supervisor nudge:
1. Reconcile the branch divergence before any push.
2. If this lane keeps moving, the next code-owned gap is another restart-readable recovery ownership edge, not another status pass.
