2026-05-27 09:37:58 CEST (+0200)

Changed files:
- `test/authenticated-http-push-client.test.js`

What changed:
- Added the missing stricter production-session later-phase lifecycle regressions for type/status drops on the checked path:
  `apply` status, `recovery-inspect` type, `db-journal` type, and `replay` status.
- This closes an auth-owned asymmetry in the later reads: the file already pinned one half of those type/status failures, but not the complementary strict cases, which left reliable without complete production-session lifecycle coverage across the checked phases most relevant to the live release boundary.
- Kept the change lane-owned and release-relevant by extending the checked production-session lifecycle surface instead of adding another malformed-field or same-shape identity-only variant.

Commands run:
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`
- `node --check test/authenticated-http-push-client.test.js`
- `timeout 120s node --test --test-name-pattern='production-shaped authenticated push fails closed when journal readback loses the production auth session type under the stricter production-session gate|production-shaped authenticated push fails closed when apply drops the production auth session status under the stricter production-session gate|production-shaped authenticated push fails closed when recovery inspect drops the production auth session type under the stricter production-session gate|production-shaped authenticated push fails closed when replay drops the production auth session status under the stricter production-session gate' test/authenticated-http-push-client.test.js`
- `git diff --check -- test/authenticated-http-push-client.test.js`

Push result:
- Pending commit/push

Worktree status:
- `## lane/auth-session-code-20260526-1836...origin/lane/auth-session-code-20260526-1836`
- `M .lane-output/final.md`
- `M test/authenticated-http-push-client.test.js`

Next supervisor nudge:
- Reliable can now consume complete strict later-phase production-session lifecycle coverage for type/status drift across `apply`, `recovery-inspect`, `db-journal`, and `replay`, not just the earlier identity-only parity set.
- The next auth-owned gap is still checked real-endpoint production lifecycle proof and release-path source/session issuance/readback, not another same-shape later-phase lifecycle variant.
