Timestamp: `2026-05-27 08:14:32 CEST (+0200)`.

Changed files:
- [test/authenticated-http-push-client.test.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/auth-session-code/test/authenticated-http-push-client.test.js)
- [.lane-output/final.md](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/auth-session-code/.lane-output/final.md)

What changed:
- Added the missing apply-path malformed `auth.session.type` unchecked coverage.
- Added the matching apply-path malformed `auth.session.type` stricter production-session gate coverage.
- This closes the apply-session type parity gap against the existing apply `id`/`status`/`expiresAt` matrix and replay-path type checks.

Commands run:
```bash
grep -nE "malformed apply auth session type" test/authenticated-http-push-client.test.js
sed -n '28220,28440p' test/authenticated-http-push-client.test.js
node --check test/authenticated-http-push-client.test.js
timeout 120s node --test --test-name-pattern='production-shaped authenticated push fails closed on malformed apply auth session types even without the stricter production-session gate|production-shaped authenticated push fails closed on malformed apply auth session types under the stricter production-session gate' test/authenticated-http-push-client.test.js
git diff --check -- test/authenticated-http-push-client.test.js
date '+%Y-%m-%d %H:%M:%S %Z (%z)'
```

Push result:
- pending commit/push for the apply auth-session type parity patch

Worktree status:
```bash
## lane/auth-session-code-20260526-1836...origin/lane/auth-session-code-20260526-1836
 M .lane-output/final.md
 M test/authenticated-http-push-client.test.js
```

Next supervisor nudge:
- This lane’s remaining auth-session value is still reliable-owned checked release-path consumption of apply/replay/recovery/journal lifecycle failures on the real-endpoint boundary, unless another concrete local parity gap appears in the malformed auth-session matrix.
