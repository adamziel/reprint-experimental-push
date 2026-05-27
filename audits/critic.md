# Critic Verdict

Current reliable head: `4a8447f5074873b27d90c91b35ea0bc11f62c911`
(`Preserve explicit auth session expiry markers`).

Verdict: `0/4`

Reason:

- This head only preserves explicit `expired` markers in the auth/session
  lifecycle summary and adds coverage that distinguishes expired and rotated
  observations from preserved reads.
- That is useful proof-shape hardening, but it still runs inside the
  production-shaped release verifier surface. It does not prove the missing
  production-owned source mutation boundary on the real Reprint endpoint with
  live auth/session issuance and readback, restart-readable durable journal
  storage with lease fencing, preserved rejected-remote evidence, and
  apply-time revalidation before mutation. Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should move from proof-shape accounting to the real
  production boundary on the checked release path: live auth/session issuance
  and readback, restart-readable durable journal storage with lease fencing,
  preserved rejected-remote evidence, and apply-time revalidation before
  mutation. The proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
