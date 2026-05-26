2026-05-26 21:41:43 CEST (+0200)

Changed files:
- [src/authenticated-http-push-client.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/auth-session-code/src/authenticated-http-push-client.js)
- [test/authenticated-http-push-client.test.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/auth-session-code/test/authenticated-http-push-client.test.js)

What changed:
- Re-aligned producer-side `authSessionLifecycleSummary.preserved` with the checked-path canonical helper: it now records the first preserved read in history instead of the last preserved read.
- Updated focused client coverage so the revoked/cleaned-up multi-read flow asserts the canonical preserved marker (`dry-run`) rather than the later replay step.

Commands run:
- `git status --short --branch`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`
- `node --check src/authenticated-http-push-client.js`
- `node --check test/authenticated-http-push-client.test.js`
- `timeout 90s node --test --test-name-pattern='production-shaped authenticated push records revoked and cleaned-up auth session lifecycle observations|production-shaped authenticated push fails closed on an expired preflight session even without the stricter production-session gate' test/authenticated-http-push-client.test.js`
- `git diff --check`

Push result:
- Pending commit/push from this worktree.

Worktree status:
- Dirty in the two changed files above until commit/push completes.

Next supervisor nudge:
- Pull this lane patch into reliable if the checked release path still compares producer-side `authSessionLifecycleSummary.preserved` against the canonical trace summarizer; before this fix, multi-read traces could disagree on whether the preserved marker was the first or last preserved read.
