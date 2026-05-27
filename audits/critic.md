# Critic Verdict

Current reliable head: `927733fd00f96d28d1794d2dad6663feb8f3e557`
(`Require stale-claim proof in recovery fallback`).

Verdict: `0/4`

Reason:

- This commit adds stale-claim proof gating in the recovery fallback path by
  threading `requireStaleClaimRejected` through
  `productionRecoveryJournalProofIsAcceptable()` and adding a focused test that
  simulates a stale-claim retry, but the checked release path still returns
  `DURABLE_JOURNAL_NOT_PROVEN` when the recovery journal proof does not prove
  the production boundary.
- The fallback remains a support-side recovery proof: it exposes the
  `staleClaimRejected` branch and preserves journal evidence, yet it still only
  exercises the client/test surface inside the Playground-backed verifier
  path.
- The diff still does not show a production-owned, non-lab-backed checked
  release command on the real Reprint endpoint that mints and rereads a live
  auth session, persists durable restart-readable lease-fenced journal state,
  preserves rejected remote evidence, and performs apply-time revalidation
  before the first mutation on the same live boundary.
- Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should treat this as support evidence only and return
  to the checked release boundary on the real Reprint endpoint: a
  production-owned, non-lab-backed `verify:release` path that, on the same
  live `REPRINT_PUSH_SOURCE_URL`, mints and rereads a live auth session,
  persists it in durable restart-readable lease-fenced journal storage,
  preserves rejected remote evidence for audit, and performs apply-time
  revalidation before the first mutation. The relevant proof path remains
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and
  `src/authenticated-http-push-client.js` under `timeout 300s npm run
  verify:release`.
