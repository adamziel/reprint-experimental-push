2026-05-26 21:04:35 CEST (+0200)

Changed files:
- [scripts/playground/production-auth-session-lifecycle.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/auth-session-code/scripts/playground/production-auth-session-lifecycle.js)
- [test/production-shaped-proof.test.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/auth-session-code/test/production-shaped-proof.test.js)

What changed:
- Tightened `evaluateProductionAuthSessionLifecycleSummary()` so malformed lifecycle flags on intermediate `observations[]` entries fail closed as explicit `invalid-*` results before the helper can collapse them into generic `rotated` or other preserved-read failures.
- Added focused summary-proof coverage for malformed intermediate observed lifecycle flags and cleanup aliases, including `cleanup`, `revoked`, `expired`, `cleanedUp`, and `rotated`.

Commands run:
- `git status --short --branch`
- `sed -n '1,220p' AGENTS.md`
- `sed -n '1,220p' supervision/README.md`
- `sed -n '1,220p' .lane-output/final-loop-20260526-205935.md`
- `sed -n '1,220p' .lane-output/final-loop-20260526-210101.md`
- `sed -n '1,260p' scripts/playground/production-auth-session-lifecycle.js`
- `sed -n '260,560p' scripts/playground/production-auth-session-lifecycle.js`
- `sed -n '2230,3535p' test/production-shaped-proof.test.js`
- `node --check scripts/playground/production-auth-session-lifecycle.js`
- `node --check test/production-shaped-proof.test.js`
- `timeout 90s node --test --test-name-pattern='production auth/session lifecycle summary fails closed when an intermediate preserved-read cleanup alias is a string value|production auth/session lifecycle summary fails closed when an intermediate preserved-read lifecycle flag is malformed|production auth/session lifecycle summary fails closed when direct rotated metadata is a string value|production auth/session lifecycle summary fails closed when direct preserved-read preservation flags are string values' test/production-shaped-proof.test.js`
- `git diff --check`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`
- `git commit -m "Fail closed on malformed observed lifecycle flags"`
- `git push origin HEAD:lane/auth-session-code-20260526-1836`

Push result:
- Pushed `cc1da0a8b143befca9c3405ac0343c990b596adf` to `origin/lane/auth-session-code-20260526-1836`

Worktree status:
- Clean on `lane/auth-session-code-20260526-1836`, tracking `origin/lane/auth-session-code-20260526-1836`

Next supervisor nudge:
- Pull `cc1da0a8` into reliable if the checked release-path auth/session summary can still be poisoned by malformed intermediate observed lifecycle flags.
- If reliable already enforces that path upstream, keep this lane on the next untested preserved-session summary branch where invalid `observations[]` metadata still degrades to a generic preserved-read failure instead of an explicit `invalid-*` result.
