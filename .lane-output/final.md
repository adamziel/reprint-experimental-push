# no-data-loss-invariants handoff

Timestamp:
- `2026-05-26 16:07:43 CEST (+0200)`

Current lane evidence:
- The planner now fail-closes unsupported WordPress surfaces even when local and remote independently converge on the same content. Unsupported GUID and legacy-link rows no longer slip through as `already-in-sync`.
- Matching independent edits still stay `already-in-sync`, and unrelated remote-only plugin drift still stays `keep-remote`.

Changed files:
- [`src/planner.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants-clean-20260526-1530/src/planner.js)
- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants-clean-20260526-1530/test/push-planner.test.js)
- [`docs/scenario-matrix.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants-clean-20260526-1530/docs/scenario-matrix.md)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants-clean-20260526-1530/.lane-output/final.md)

Commands run:
- `node --input-type=module <<'EOF' ... createPushPlan(...) ... EOF`
- `timeout 60s node --test --test-name-pattern='blocks converged post GUID changes while preserving a matching independent edit and remote-only plugin changes|blocks converged legacy link changes while preserving a matching independent edit and remote-only plugin changes' test/push-planner.test.js`
- `git diff --check -- src/planner.js test/push-planner.test.js docs/scenario-matrix.md`
- `git status --short --branch`

Push result:
- Pending commit/push from this worktree.

Worktree status:
- Dirty tracked state limited to the four lane-owned files above.
- Branch: `lane/cycle-20260525-mainwindows-2349/ndl-invariants-clean-20260526-1530`
- `HEAD`: `00199613`

Next supervisor nudge:
- If reliable or same-plan-graph exposes another converged unsupported resource class, route it back here; otherwise the next useful invariant edge is the same fail-closed behavior for any remaining unsupported row class that can still reach `already-in-sync`.
