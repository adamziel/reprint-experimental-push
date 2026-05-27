# Critic Verdict

Current reliable head: `bc4679930d9d27adfb84b49b075816ff2e4d9ead`
(`Tighten replay auth session equivalence`).

Verdict: `0/4`

Reason:

- This head tightens replay equivalence for the authenticated push client:
  replay now compares auth-session lifecycle bits for revoked, cleaned-up,
  rotated, preserved, and expired state, and reports field-level mismatches
  such as `authSessionPreserved`.
- That is useful auth/session replay hardening, but it still runs inside the
  production-shaped harness. It does not prove the missing production-owned
  source mutation boundary on the real Reprint endpoint with live auth/session
  issuance and readback, restart-readable durable journal storage with lease
  fencing, preserved rejected-remote evidence, and apply-time revalidation
  before mutation. Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should move from replay/auth-session equivalence
  hardening to the real production boundary on the checked release path: live
  auth/session issuance and readback, restart-readable durable journal storage
  with lease fencing, preserved rejected-remote evidence, and apply-time
  revalidation before mutation. The proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
