# no-data-loss-invariants handoff

Timestamp:
- `2026-05-26 17:49:12 CEST (+0200)`

Current lane evidence:
- The planner now emits the specific `comment post target` stale-identity reason when a same-plan `wp_comments.comment_post_ID` reference points at a locally created post row.
- The blocker still preserves matching independent edits as `already-in-sync`, preserves unrelated remote-only plugin drift as `keep-remote`, and keeps raw comment/post payloads out of blocker evidence.

Changed files:
- [`src/planner.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants-clean-20260526-1530/src/planner.js)
- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants-clean-20260526-1530/test/push-planner.test.js)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants-clean-20260526-1530/.lane-output/final.md)

Commands run:
- `git diff --check`
- `timeout 120s node --test test/push-planner.test.js --test-name-pattern='blocks local comments graph references to a same-plan created post identity'`
- `timeout 30s node --input-type=module <<'EOF' ... createPushPlan(...) ... EOF`
- `git status --short --branch`

Push result:
- Pending commit/push from this worktree at handoff write time.

Worktree status:
- Dirty tracked state limited to the three lane-owned files above.
- Branch: `lane/cycle-20260525-mainwindows-2349/ndl-invariants-clean-20260526-1530`
- `HEAD`: `c8b9c4c6`

Next supervisor nudge:
- If another same-plan WordPress graph blocker still falls back to the generic `relationship that depends on it` reason, route it here for the same explicit fail-closed reason tightening; otherwise keep this lane on unsupported planner surfaces that can still under-report blocker context.
