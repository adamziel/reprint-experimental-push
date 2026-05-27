# Critic Verdict

Current reliable head: `349826d919f747c8a3d207a8f39faf9c67e9fa92`
(`Fail closed on stale auth session summaries`).

Verdict: `0/4`

Reason:

- This head adds fail-closed checks for stale auth-session lifecycle summary
  fields in the production-shaped push client and extends the playground
  auth/session lifecycle verifier with stale-issued, stale-read, and missing
  preserved-phase coverage. The new tests exercise malformed auth metadata at
  dry-run, apply, recovery-inspect, replay, and journal readback and confirm
  the client stops before proceeding when those summary fields drift.
- That is still support-only hardening, not proof of the production-owned real
  Reprint endpoint boundary. The evidence still comes from mocked or
  production-shaped flows rather than live auth/session issuance and readback,
  durable restart-readable journal ownership with lease fencing, preserved
  rejected-remote evidence, and apply-time revalidation before the first
  mutation on that same boundary. Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should move from unchecked-auth-metadata hardening to
  the real production boundary on the checked release path: live auth/session
  issuance and readback, restart-readable durable journal storage with lease
  fencing, preserved rejected-remote evidence, and apply-time revalidation
  before the first mutation. The proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
