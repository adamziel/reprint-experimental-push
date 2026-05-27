# Critic Verdict

Current reliable head: `478407dde9e178c1967b4e0873c63ad5e30e23e2`
(`Preserve checked journal claim identity`).

Verdict: `0/4`

Reason:

- This head preserves the checked journal writer claim identity in the
  authenticated client summaries. `src/authenticated-http-push-client.js` now
  carries non-empty `writerLease.claimId` through DB-journal and lease-fence
  summaries, and the focused test proves the nested writer-lease claim ID is
  visible on the checked path.
- That is useful claim-identity hardening, but still support-side evidence. It
  does not prove a production-owned, non-lab-backed source mutation boundary on
  the real Reprint endpoint with live auth/session issuance and readback,
  restart-readable durable journal storage with lease fencing, preserved
  rejected-remote evidence, and apply-time revalidation before mutation.
  Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should land the next exact primitive beyond checked
  claim-identity surfacing: a production-owned, non-lab-backed source mutation
  / auth-session boundary on the real Reprint endpoint that issues a live
  session, reads it back after restart from durable journal storage, enforces
  lease-fenced ownership of those journal rows, preserves rejected-remote
  evidence, and revalidates the session at apply time before mutation without
  falling back to Playground package-mode scaffolding. The proof should come
  through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
