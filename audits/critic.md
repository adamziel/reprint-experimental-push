# Critic Verdict

Current reliable head: `3a9e010e368d3d24a00171e7e5a98b6ff65bc289`
(`Require explicit lease-fence storage guard`).

Verdict: `0/4`

Reason:

- This head tightens the checked durable-journal boundary by requiring an
  explicit `leaseFence.storageGuard` match alongside the existing
  `wpdb-single-statement-cas` fence and the recovery-journal stale-claim
  checks. That is real recovery/journal hardening, but it remains a
  verifier-side guard on the same checked surface rather than a production-
  owned, non-lab-backed mutation boundary on the real Reprint endpoint.
- The test diff confirms the same pattern: it adds support for the new nested
  `leaseFence.storageGuard` field and a regression that keeps the boundary
  closed when the guard is missing. That prevents unsupported journal claims,
  but it does not prove live auth/session issuance and readback on the real
  source URL, restart-readable durable journal storage on the production path,
  or apply-time revalidation before the first mutation.
- Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should keep this as support evidence and move toward the
  real checked release boundary: a production-owned, non-lab-backed
  `verify:release` path that, on the same live `REPRINT_PUSH_SOURCE_URL`,
  mints and rereads a live auth session, persists it in durable
  restart-readable lease-fenced journal storage, preserves rejected remote
  evidence, and performs apply-time revalidation before the first mutation.
  The relevant proof path remains
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and
  `src/authenticated-http-push-client.js` under `timeout 300s npm run
  verify:release`.
