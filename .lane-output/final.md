# no-data-loss-invariants handoff

Timestamp:
- `2026-05-27 04:15:46 CEST (+0200)`

Current lane evidence:
- Added the missing plain unsupported `wp_users` parity case for `matching independent restore + remote-only plugin changes`.
- The new case proves the planner still blocks the local `wp_users` row as `unsupported-comments-users-resource`, preserves the matching file restore as `already-in-sync`, keeps remote-only plugin changes as `keep-remote`, and emits no user mutation.
- Blocker evidence remains redacted: the blocked plan JSON does not leak the local/base user identifiers or the restored file payload.

Changed files:
- [test/push-planner.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants-clean-20260526-1530/test/push-planner.test.js)
- [.lane-output/final.md](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-invariants-clean-20260526-1530/.lane-output/final.md)

Commands:
- `timeout 60s node --test test/push-planner.test.js --test-name-pattern='blocks local users graph resources while preserving a matching independent restore and remote-only plugin changes'`
- `timeout 60s sh -lc "node --test test/push-planner.test.js --test-name-pattern='blocks local users graph resources while preserving a matching independent restore and remote-only plugin changes' 2>&1 | grep -F 'blocks local users graph resources while preserving a matching independent restore and remote-only plugin changes'"`
- `git diff --check`
- `git add test/push-planner.test.js .lane-output/final.md && git commit -m "Cover blocked plain user restore changes" && git push origin HEAD:lane/no-data-loss-invariants`
- `git status --short --branch`

Push result:
- Pending.

Worktree status:
- Dirty tracked state is limited to the new planner test plus this handoff refresh.
- Branch head will advance from `ecd7ff4bc1c1b5244ee50ee54f7b6b960f687654` after commit/push.

Next supervisor nudge:
- Treat the next invariants head as the current plain-user parity update. The plain unsupported `wp_users` matrix now covers remote-only drift/removals, matching edit with plugin removals/changes, matching delete with plugin changes, matching restore with plugin removals/changes, matching row delete with plugin removals, and matching file type swap with plugin removals/changes.
- The next smallest plain-user parity gap is likely `matching independent delete + remote-only plugin changes`, unless a higher-value fail-closed invariant overtakes this cluster first.
