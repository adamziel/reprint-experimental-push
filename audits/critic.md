# Critic Verdict

Current reliable head: `45ea450613d972f4901371cbd38b11c53ba5c0b0`
(`Use auth session source CLI in generated commands`).

Verdict: `0/4`

Reason:

- This head threads the auth-session source CLI into generated release-path
  commands via `scripts/playground/auth-session-source-command.js` and updates
  the proof fixtures in `test/production-shaped-proof.test.js` and
  `test/protocol-fixtures.test.js`, but it still only improves helper
  selection for the checked verifier path.
- The diff does not yet prove live auth/session issuance and readback on the
  real endpoint, restart-readable durable journal storage with lease-fenced
  ownership, preserved rejected remote evidence on the live boundary, or
  apply-time revalidation before the first mutation on the same production
  boundary.
- So the verdict remains `0/4`: `45ea4506` is useful release-path plumbing,
  not a gate-closing production-boundary proof.

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
