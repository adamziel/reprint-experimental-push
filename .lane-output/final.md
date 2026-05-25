# no-data-loss-invariants handoff

Captured the current lane-owned gap instead of repeating the already-proved attachment, taxonomy, or `_thumbnail_id` surfaces.

Evidence:
- `docs/scenario-matrix.md` now explicitly marks menu/nav graph references as unproven in the current planner model.
- The planner docs still group nav menus with other reference-graph classes that are not yet covered by executable proof.
- The focused test search still does not surface a menu/nav proof in `test/push-planner.test.js`; the only hits are the existing docs references.
- The focused attachment probe remains green, so re-running that class would not change the verdict.

Changed files:
- [`docs/scenario-matrix.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants/docs/scenario-matrix.md)
Commands run:
- `rg -n "menu|nav|navigation|plugin/theme file|theme file|plugin file|file identity drift|remote-only deletion|deletion restoration|restore|wp_terms.*menu|menu_item|menu-item|nav_menu" test/push-planner.test.js docs/scenario-matrix.md docs/invariants/no-data-loss-invariants.md src/planner.js`
- `git status --short --branch && git rev-parse --short HEAD && git rev-parse --short origin/lane/no-data-loss-invariants`
- `git diff -- docs/scenario-matrix.md`
- `sed -n '620,670p' docs/scenario-matrix.md`
- `node --test --test-name-pattern='thumbnail_id|featured-image-attachment|attachment' test/push-planner.test.js`

Push result:
- None

Worktree status:
- Dirty tracked file: `docs/scenario-matrix.md`
- Branch: `lane/cycle-20260526-mainwindows-2349/no-data-loss-invariants-integration`
- `HEAD`: `09c63a25`
- `origin/lane/no-data-loss-invariants`: `fa0ce3ea`

Next supervisor nudge:
- Either turn the menu/nav graph gap into an executable fixture-backed proof, or keep it documented as pending and hand this lane a different unproved reference-graph class.
