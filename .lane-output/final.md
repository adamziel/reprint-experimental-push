Timestamp: `2026-05-27 08:09:09 CEST (+0200)`.

Changed files:
- [test/authenticated-http-push-client.test.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/auth-session-code/test/authenticated-http-push-client.test.js)
- [.lane-output/final.md](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/auth-session-code/.lane-output/final.md)

What changed:
- Tightened the journal-only malformed auth-identity coverage for `auth.identity.userLogin` and `auth.identity.userId`.
- The stricter and unchecked journal cases now both require the mirrored `invalidIdentityField` markers on `authSessionLifecycleTrace.at(-1)` and `authSessionLifecycleSummary.read`, matching the replay, recovery, and apply-path parity this lane already established.
- This closes the remaining journal identity-summary assertion gap without adding another overlapping auth-session scenario.

Commands run:
```bash
git log --oneline --decorate -15
grep -n "journal-only malformed auth-session" test/authenticated-http-push-client.test.js
sed -n '24885,25840p' test/authenticated-http-push-client.test.js
node --check test/authenticated-http-push-client.test.js
timeout 120s node --test --test-name-pattern='production-shaped authenticated push fails closed on journal-only malformed auth user login drift|production-shaped authenticated push fails closed on journal-only malformed auth user id drift' test/authenticated-http-push-client.test.js
git diff --check -- test/authenticated-http-push-client.test.js
date '+%Y-%m-%d %H:%M:%S %Z (%z)'
```

Push result:
- pending commit/push for the journal identity-summary parity patch

Worktree status:
```bash
## lane/auth-session-code-20260526-1836...origin/lane/auth-session-code-20260526-1836
 M .lane-output/final.md
 M test/authenticated-http-push-client.test.js
```

Next supervisor nudge:
- This lane’s next auth-session value is still reliable-owned checked release-path consumption of these journal/apply/replay/recovery lifecycle failures on the real-endpoint boundary, unless another concrete auth-session summary or source-resolution parity gap appears.
