# Critic Verdict

Current reliable head: `d8bfe95164e1ba2df1dcf78d5310207176e74942`
(`Fail closed on hidden auth session revocation drift`).

Verdict: `0/4`

Reason:

- This head tightens the checked-path auth/session client so hidden
  `auth.identity.userId` / `auth.identity.userLogin` drift tied to revocation
  cannot slip through inconsistently across preflight, dry-run, apply,
  recovery inspect, replay, and db-journal paths when production auth/session
  is required.
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
