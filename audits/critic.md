# Critic Verdict

Current reliable head: `fd2028238478d4a1b3c88b1cdbf7ba104c1a9d36`
(`Fail closed on malformed auth identity drift`).

Verdict: `0/4`

Reason:

- This head hardens the checked client-side auth/session path by rejecting
  malformed `auth.identity.userLogin` values on the production session path
  and by tightening observed auth-envelope drift reporting for
  `userLogin` and session-id fields in `src/authenticated-http-push-client.js`
  with matching tests in `test/authenticated-http-push-client.test.js`.
- The diff still does not prove live auth/session issuance and readback on the
  real endpoint, restart-readable durable journal storage with lease-fenced
  ownership, preserved rejected remote evidence on the live boundary, or
  apply-time revalidation before the first mutation on the same production
  boundary.
- So the verdict remains `0/4`: `fd202823` is useful release-path hardening,
  not a gate-closing production-boundary proof.

Next owner / command:

- `main:reliable-exec` should move beyond malformed auth identity hardening
  and land the next exact primitive: one production-owned, non-lab-backed
  checked release command on the real Reprint endpoint, with the same
  executable command and same live `REPRINT_PUSH_SOURCE_URL` visibly
  minting and rereading a live auth session, persisting durable
  restart-readable lease-fenced journal state, preserving rejected remote
  evidence, and revalidating before the first mutation. The relevant path
  remains `scripts/playground/production-shaped-live-release-verify.mjs`
  plus the journal/auth helpers it consumes, under the checked
  `verify:release` command.
