2026-05-26 21:37:27 CEST (+0200)

Changed files:
- [src/authenticated-http-push-client.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/auth-session-code/src/authenticated-http-push-client.js)
- [test/authenticated-http-push-client.test.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/auth-session-code/test/authenticated-http-push-client.test.js)

What changed:
- Aligned `summarizeAuthSessionLifecycleHistory()` with the canonical trace-summary shape so producer-side `authSessionLifecycleSummary` now carries top-level `expired`, `revoked`, `cleanedUp`, `rotated`, and `preserved` markers instead of only `{ issued, read, observations }`.
- Switched the summary’s top-level `read` and `preserved` selection to the last actual read-phase observation, which keeps cleanup/non-read history from becoming the canonical preserved-read marker.
- Added focused client-side regression coverage for the richer summary shape on expired preflight history and revoked/cleaned-up multi-step history.

Commands run:
- `git status --short --branch`
- `sed -n '1,220p' AGENTS.md`
- `sed -n '1,220p' supervision/README.md`
- `find .lane-output -maxdepth 1 -type f | sort | tail -n 5 | xargs -r -I{} sh -c 'echo "--- {}"; sed -n "1,220p" "{}"'`
- `sed -n '1,260p' scripts/playground/production-auth-session-lifecycle.js`
- `sed -n '261,520p' scripts/playground/production-auth-session-lifecycle.js`
- `sed -n '520,820p' scripts/playground/production-auth-session-lifecycle.js`
- `sed -n '820,980p' scripts/playground/production-auth-session-lifecycle.js`
- `sed -n '820,960p' src/authenticated-http-push-client.js`
- `sed -n '360,520p' test/authenticated-http-push-client.test.js`
- `sed -n '600,700p' test/authenticated-http-push-client.test.js`
- `sed -n '975,1335p' test/authenticated-http-push-client.test.js`
- `node --check src/authenticated-http-push-client.js`
- `node --check test/authenticated-http-push-client.test.js`
- `timeout 90s node --test --test-name-pattern='production-shaped authenticated push fails closed on an expired preflight session even without the stricter production-session gate|production-shaped authenticated push records revoked and cleaned-up auth session lifecycle observations' test/authenticated-http-push-client.test.js`
- `timeout 90s node --test --test-name-pattern='production-shaped authenticated push records revoked and cleaned-up auth session lifecycle observations' test/authenticated-http-push-client.test.js`
- `git diff --check`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`
- `git commit -m "Align auth session summary markers"`
- `git push origin HEAD:lane/auth-session-code-20260526-1836`

Push result:
- Pushed `cab7b3be7f7cae73b8d39f89f7c41609bcff0d77` to `origin/lane/auth-session-code-20260526-1836`

Worktree status:
- Clean on `lane/auth-session-code-20260526-1836`, tracking `origin/lane/auth-session-code-20260526-1836`

Next supervisor nudge:
- Pull `cab7b3be` into reliable if the checked release path still relies on the producer-side `authSessionLifecycleSummary` and needs explicit top-level `expired` / `revoked` / `cleanedUp` / `rotated` / `preserved` markers without falling back to trace re-summarization.
- If reliable already canonicalizes the trace upstream, keep this lane on the next producer-side auth/session history inconsistency where the emitted summary can still diverge from the canonical trace-derived shape.
