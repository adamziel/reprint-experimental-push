Timestamp: `2026-05-27 07:44:23 CEST (+0200)`.

Changed files:
- [test/authenticated-http-push-client.test.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/auth-session-code/test/authenticated-http-push-client.test.js)
- [.lane-output/final.md](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/auth-session-code/.lane-output/final.md)

What changed:
- Added the missing unchecked replay malformed `auth.session.warning` fail-closed proof.
- The new test proves `runAuthenticatedHttpPush()` returns `AUTH_SESSION_LIFECYCLE_DRIFT` at the `replay` boundary even without `requireProductionAuthSession: true`, marks `invalidIdentityField: 'warning'` in `authSessionLifecycleTrace` and `authSessionLifecycleSummary.read`, keeps the durable-journal boundary at `PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED`, and never reaches `/db-journal`.

Commands run:
```bash
node --check test/authenticated-http-push-client.test.js
timeout 120s node --test --test-name-pattern='production-shaped authenticated push fails closed on malformed replay auth session warnings even without the stricter production-session gate' test/authenticated-http-push-client.test.js
git diff --check -- test/authenticated-http-push-client.test.js
date '+%Y-%m-%d %H:%M:%S %Z (%z)'
git add test/authenticated-http-push-client.test.js
git commit -m "Cover unchecked replay auth warning drift"
git push origin HEAD:lane/auth-session-code-20260526-1836
git log --oneline -3
git status --short --branch
```

Push result:
- pending

Worktree status:
```bash
## lane/auth-session-code-20260526-1836...origin/lane/auth-session-code-20260526-1836
 M .lane-output/final.md
 M test/authenticated-http-push-client.test.js
```

Next supervisor nudge:
- Unchecked replay malformed `auth.session.warning` parity is now closed. The next auth-session dependency is still reliable-owned checked release-path consumption of these replay/lifecycle guards, or the exact production auth/session primitive still missing on the real-endpoint path.
