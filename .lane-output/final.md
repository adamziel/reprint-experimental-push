# no-data-loss-invariants handoff

Added one executable unsupported-surface block for WordPress navigation graph resources, and kept the existing graph-identity proofs intact.

Evidence:
- The planner now hard-blocks `wp_posts` rows whose `post_type` is `wp_navigation`, with `unsupported-navigation-resource` evidence and no mutation emitted.
- The focused planner slice passes for `wp_termmeta.term_id`, `wp_term_relationships.object_id`, and the new navigation block.

Changed files:
- [`src/planner.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants/src/planner.js)
- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants/test/push-planner.test.js)
- [`docs/scenario-matrix.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants/docs/scenario-matrix.md)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants/.lane-output/final.md)

Commands run:
- `node --test --test-name-pattern='blocks local navigation graph resources while preserving remote-only plugin drift|blocks local term-relationship object references when the live remote post identity disappears while preserving remote-only plugin drift|blocks local termmeta references when the live remote term identity disappears while preserving remote-only plugin drift' test/push-planner.test.js`
- `git diff -- src/planner.js test/push-planner.test.js docs/scenario-matrix.md`
- `sed -n '536,548p' docs/scenario-matrix.md`
- `sed -n '644,652p' docs/scenario-matrix.md`

Push result:
- Not pushed yet

Worktree status:
- Dirty tracked files: `src/planner.js`, `test/push-planner.test.js`, `docs/scenario-matrix.md`, `.lane-output/final.md`
- Branch: `lane/cycle-20260526-mainwindows-2349/no-data-loss-invariants-integration`
- `HEAD`: `97c3beb8`
- `origin/lane/no-data-loss-invariants`: `668f886c`

Next supervisor nudge:
- Publish this navigation block and keep this lane on the next unsupported WordPress graph boundary if the supervisor wants one more executable stop rather than another graph-identity proof.
