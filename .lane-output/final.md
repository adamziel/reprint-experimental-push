# no-data-loss-invariants handoff

Current lane evidence is that the unsupported-surface stops now cover comments/users, serialized block references, and plugin-owned custom-table mismatches without leaking payload values. I also tightened the wrong-driver proof so it still blocks while unrelated remote-only plugin drift is preserved.

Evidence:
- The planner hard-blocks `wp_comments` and `wp_users` rows as `unsupported-comments-users-resource`.
- The planner hard-blocks `wp_posts` rows whose `post_content` contains serialized block markup as `unsupported-serialized-blocks-resource`.
- Plugin-owned rows with a declared driver mismatch stay blocked while unrelated remote-only plugin drift remains `keep-remote`.

Changed files:
- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants/test/push-planner.test.js)
- [`docs/scenario-matrix.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants/docs/scenario-matrix.md)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants/.lane-output/final.md)

Commands run:
- `node --test --test-name-pattern='blocks plugin-owned resources when the declared driver does not match the table|blocks plugin-owned resources when the declared driver does not match the table while preserving remote-only plugin drift' test/push-planner.test.js`
- `git status --short --branch`

Push result:
- Not pushed

Worktree status:
- Dirty tracked files: `src/planner.js`, `test/push-planner.test.js`, `docs/scenario-matrix.md`, `.lane-output/final.md`
- Branch: `lane/cycle-20260526-mainwindows-2349/no-data-loss-invariants-integration`
- `HEAD`: `ae8ce5d3`
- `origin/lane/no-data-loss-invariants`: `5b25867b`

Next supervisor nudge:
- If this lane should keep moving, assign the next unsupported boundary to hard-block; otherwise reconcile and push the current head with the existing dirty planner file handled separately.
