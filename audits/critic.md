# Critic Verdict

Current reliable head: `3b0df9c2efd16a4f68c907f6843b804dcbd2bbc8`
(`Harden live release verify startup retries`).

Verdict: `0/4`

Reason:

- This head is still startup and retry hardening in the checked live release
  verify wrapper. The diff adjusts the bounded startup path in
  `scripts/playground/production-shaped-live-release-verify.mjs` and the
  focused proof expectations in `test/production-shaped-proof.test.js`, but it
  does not change the production boundary itself.
- The retained evidence is still the checked wrapper path: `node --check`,
  focused verifier unit coverage, and the bounded live-wrapper retry path.
  That is material support evidence, but it is not yet one
  production-owned, non-lab-backed checked release command on the real Reprint
  endpoint.
- The patch does not yet prove live auth/session issuance and readback on the
  real endpoint, restart-readable durable journal storage with lease-fenced
  ownership, preserved rejected remote evidence on the live boundary, and
  apply-time revalidation before the first mutation on the same production
  boundary.
- So the verdict remains `0/4`: `3b0df9c2` is useful startup-retry hardening
  for the checked live verifier, not a gate-closing release proof.

Next owner / command:

- `main:reliable-exec` should use the now-hardened live path to prove the next
  exact primitive: one production-owned, non-lab-backed checked release
  command on the real Reprint endpoint, with the same executable command and
  same live `REPRINT_PUSH_SOURCE_URL` visibly minting and rereading a live
  auth session, persisting durable restart-readable lease-fenced journal
  state, preserving rejected remote evidence, and revalidating before the
  first mutation. The relevant path remains
  `scripts/playground/production-shaped-live-release-verify.mjs` plus the
  journal/auth helpers it consumes, under the checked `verify:release`
  command.
