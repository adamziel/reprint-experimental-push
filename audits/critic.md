# Critic Verdict

Current reliable head: `5be6341164ce667bd026b2e4ae92bc10f688b431`
(`Ignore post-boundary auth session cleanup drift`).

Verdict: `0/4`

Reason:

- This head narrows auth/session lifecycle evaluation to observations through
  the selected release-boundary read. Cleanup, revocation, rotation, or expiry
  after that boundary no longer poisons a previously preserved checked read.
- That is useful release-boundary accounting hardening, but it still runs in
  the production-shaped/Playground proof surface. It does not prove the
  missing production-owned source mutation boundary on the real Reprint
  endpoint with live auth/session issuance and readback, restart-readable
  durable journal storage with lease fencing, preserved rejected-remote
  evidence, and apply-time revalidation before mutation. Verdict therefore
  remains `0/4`.

Next owner / command:

- `main:reliable-exec` should move from release-boundary lifecycle accounting
  to the real production boundary on the checked release path: live
  auth/session issuance and readback, restart-readable durable journal storage
  with lease fencing, preserved rejected-remote evidence, and apply-time
  revalidation before mutation. The proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
