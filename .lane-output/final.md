# no-data-loss-invariants handoff

Added one fixture-backed proof for a missing live remote term identity under `wp_term_taxonomy.parent`, and tightened the remaining matrix gap to the narrower parent-reference class.

Evidence:
- `test/push-planner.test.js` now blocks a `wp_term_taxonomy` row whose `parent` points at a live remote term that no longer exists, and verifies the blocker shape, remote precondition, and refusal to apply.
- `docs/scenario-matrix.md` now narrows the unproved graph gap from the whole `wp_term_taxonomy` bucket to `wp_term_taxonomy.parent`.
- The focused proof for the new scenario passes.

Changed files:
- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants/test/push-planner.test.js)
- [`docs/scenario-matrix.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants/docs/scenario-matrix.md)

Commands run:
- `git status --short --branch && git rev-parse --short HEAD && git rev-parse --short origin/lane/no-data-loss-invariants && git rev-parse --short origin/lane/cycle-20260526-mainwindows-2349/no-data-loss-invariants-integration`
- `git diff -- test/push-planner.test.js docs/scenario-matrix.md .lane-output/final.md`
- `node --test --test-name-pattern='keeps same-remote graph identity at the live release boundary while a ready delete plan preserves a matching independent file delete, a matching file type swap, a matching independent edit, and remote-only plugin removals after apply revalidation' test/push-planner.test.js`

Push result:
- Pending

Worktree status:
- Dirty tracked files: `test/push-planner.test.js`, `docs/scenario-matrix.md`, `.lane-output/final.md`
- Branch: `lane/cycle-20260526-mainwindows-2349/no-data-loss-invariants-integration`
- `HEAD`: `668f886c`
- `origin/lane/no-data-loss-invariants`: `668f886c`

Next supervisor nudge:
- Commit and push the integration branch if the lane wants this proof published, or assign a distinct unproved reference-graph class if the remaining parent-reference gap is not the next target.
