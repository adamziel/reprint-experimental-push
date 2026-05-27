Timestamp: `2026-05-27 05:42:02 CEST (+0200)`.

Changed files:
- [src/authenticated-http-push-client.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/auth-session-code/src/authenticated-http-push-client.js)
- [test/authenticated-http-push-client.test.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/auth-session-code/test/authenticated-http-push-client.test.js)

What changed:
- Added unchecked-path fail-closed handling for malformed `auth.session.warning` metadata on checked readback phases: `apply`, `recovery-inspect`, `replay`, and `journal`.
- Added the missing journal regression proving unchecked malformed journal warning drift now returns `AUTH_SESSION_LIFECYCLE_DRIFT` and stops at the durable-journal boundary instead of being silently accepted.

Commands run:
```bash
date '+%Y-%m-%d %H:%M:%S %Z (%z)'
node --check src/authenticated-http-push-client.js
node --check test/authenticated-http-push-client.test.js
timeout 90s node --test test/authenticated-http-push-client.test.js --test-name-pattern='journal-only malformed auth-session warning drift even without the stricter production-session gate'
node --input-type=module <<'EOF'
# focused unchecked journal warning drift assertion
EOF
git diff --check
git commit -m "Fail closed on unchecked malformed auth warning drift"
git push origin HEAD:lane/auth-session-code-20260526-1836
```

Push result:
- pending

Worktree status:
```bash
## lane/auth-session-code-20260526-1836...origin/lane/auth-session-code-20260526-1836
 M .lane-output/final.md
 M src/authenticated-http-push-client.js
 M test/authenticated-http-push-client.test.js
```

Next supervisor nudge:
- reliable can now consume unchecked malformed warning drift as a real checked-path auth failure on journal/readback phases instead of relying only on the stricter production-session gate.
- The next auth-session step should target a remaining real-endpoint lifecycle hole, not another warning-surface variant.
