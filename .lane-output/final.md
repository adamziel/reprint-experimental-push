Timestamp: `2026-05-27 02:04:58 CEST (+0200)`.

Changed files:
- [test/authenticated-http-push-client.test.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/auth-session-code/test/authenticated-http-push-client.test.js)

What changed:
- Added checked-path `apply` coverage for rotated production auth-session drift, proving the push fails closed at `apply` when the session reports `rotated: true` and `preserved: false`.
- Asserted the lifecycle trace and summary shape for this branch: `rotated` is attributed to `apply`, while the preserved read remains the earlier `dry-run` observation.
- Kept the change test-only because the runtime branch was already implemented; the gap was missing phase-specific coverage.

Commands run:
```bash
git status --short --branch
grep -n "apply .*rotated\\|apply .*expired\\|apply .*status\\|apply .*without expiresAt\\|apply .*warning drift\\|apply .*playground fallback\\|apply .*cleaned-up\\|apply .*revoked" test/authenticated-http-push-client.test.js | sed -n '1,260p'
sed -n '2960,3188p' test/authenticated-http-push-client.test.js
node --check test/authenticated-http-push-client.test.js
timeout 120s node --test --test-name-pattern='production-shaped authenticated push fails closed immediately when apply reports rotated auth drift' test/authenticated-http-push-client.test.js
git diff --check
date '+%Y-%m-%d %H:%M:%S %Z (%z)'
```

Push result:
- pending commit/push from this pass

Worktree status:
```bash
## lane/auth-session-code-20260526-1836...origin/lane/auth-session-code-20260526-1836
 M .lane-output/final.md
 M test/authenticated-http-push-client.test.js
```

Next supervisor nudge:
- reliable can now treat `apply`-phase rotation drift as explicitly covered alongside the other checked auth-session lifecycle fail-closed branches.
- The next auth-session-owned gap should stay on deeper release-boundary lifecycle proof, not another `apply` source-warning variant.
