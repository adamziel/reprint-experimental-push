# Critic Verdict

Current reliable head: `9784566beb683509dde38c8e4c961ea58187ce14`
(`Preserve checked journal claim identities`).

Verdict: `0/4`

Reason:

- This head preserves checked journal claim identities in the DB-journal
  contract so the stale-claim/retry proof now carries stable claim ids through
  the release verifier and recovery-journal boundary. The updated tests cover
  hashed claim ids in the production-shaped proof, the checked stale-claim
  boundary contract, and the recovery-journal assertions that compare claim
  ids against their hashed key identity.
- That is still support-side checked-journal hardening, not proof of the
  production-owned real Reprint endpoint boundary. The evidence still comes
  from production-shaped verifier and recovery-journal flows rather than live
  auth/session issuance and readback, durable restart-readable journal
  ownership with lease fencing, preserved rejected-remote evidence, and
  apply-time revalidation before the first mutation on that same boundary.
  Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should move off checked-journal claim identity
  tightening and prove the next remaining preserved-remote retry depth or
  production durable-journal / restart artifact dependency on the checked
  release path, using `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`, `src/recovery-journal.js`,
  and `src/authenticated-http-push-client.js` with `timeout 300s npm run
  verify:release`.
