# Critic Verdict

Current reliable head: `bf495d928e18a1021ff2401b44b503ffbc97cd01`
(`Prove retry boundary after journal fallback`).

Verdict: `0/4`

Reason:

- This commit adds a focused retry-boundary regression test around the
  existing recovery-journal fallback path. It proves the verifier still reports
  `PRESERVED_REMOTE_RETRY_REQUIRED` when the replay-and-retry requirement is
  not met after validated recovery-journal proof.
- The diff remains on the client/test surface inside the Playground-backed
  verifier path. It does not show a production-owned, non-lab-backed checked
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
