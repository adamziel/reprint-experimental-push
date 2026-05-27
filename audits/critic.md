# Critic Verdict

Current reliable head: `c2288a428207d9b5daa0aa771976fb16784346a9`
(`Require checked journal claim key coherence`).

Verdict: `0/4`

Reason:

- This head tightens the checked durable-journal contract by requiring writer
  leases and nested lease-fence writer leases to carry the same claim key hash
  as the active journal claim. The client summary now preserves
  `writerLease.claimKeyHash`, and the package/recovery tests fail closed on
  claim-key drift.
- That is useful checked-boundary hardening, but it still runs inside the
  production-shaped/package harness. It does not prove the missing
  production-owned source mutation boundary on the real Reprint endpoint with
  live auth/session issuance and readback, restart-readable durable journal
  storage with lease fencing, preserved rejected-remote evidence, and
  apply-time revalidation before mutation. Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should move from checked journal claim-key coherence to
  the real production boundary on the checked release path: live auth/session
  issuance and readback, restart-readable durable journal storage with lease
  fencing, preserved rejected-remote evidence, and apply-time revalidation
  before mutation. The proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
