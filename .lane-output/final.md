Tightened the production recovery support probe so it fail-closes inherited surface claims instead of trusting prototype properties, and kept the recovery-envelope validator stricter about explicit own `status`/`reason` markers before it treats an artifact as a nested recovery envelope.

Follow-up:
- Adjusted the nearby fail-closed expectations to the new dependency order.
- Added a regression that proves a production durable journal writer with inherited `supportedSurface` / `restartReadable` claims is rejected.
- Re-ran the focused production recovery slice; it passed 4/4 with the outer timeout in place.

Changed files:
- [`src/apply.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/apply.js)
- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/push-planner.test.js)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/.lane-output/final.md)

Commands:
- `timeout 60s node --test --test-name-pattern 'production durable journal claims fail closed when supported surface is inherited through the prototype|production durable journal claims fail closed when remote artifact references are malformed|production durable journal claims fail closed when restart inspection artifact references are array-shaped|production durable journal claims fail closed when remote artifact references are empty strings' test/push-planner.test.js`
- `git status --short`
- `git diff --stat`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`

Verification:
- Focused recovery slice passed `4/4`.

Push result:
- Not pushed yet.

Worktree status:
- Dirty tracked files: `src/apply.js`, `test/push-planner.test.js`, `.lane-output/final.md`
- Branch remains ahead/behind relative to `origin/main`.

Next supervisor nudge:
1. Commit and push the coherent recovery hardening if no further expectation drift appears.
2. If the upstream divergence matters for integration, handle it with a non-destructive merge/rebase plan in a separate pass.
