# Critic Verdict

Current reliable head: `a247efd1044ced53b7139698834ac1088310b251`
(`Require journal auth on checked path`).

Verdict: `0/4`

Reason:

- This head tightens the checked-path auth/session client so malformed
  `auth.identity.userId` and drift in `auth.identity.userLogin` are rejected
  or reported consistently across preflight, dry-run, apply, recovery
  inspect, replay, and db-journal paths when production auth/session is
  required.
- That is useful checked-path hardening, but it is still not a
  production-owned source mutation boundary on the real Reprint endpoint, and
  it still does not prove live auth/session issuance/readback,
  restart-readable durable journal storage with lease fencing, or
  apply-time revalidation outside Playground package-mode scaffolding.
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
