Audited `368b7e74834ddf2e7289fa73a944d569e636e11f` (`Fail closed on fallback auth session sources`).

Verdict: `0/4`

What changed:
- `scripts/playground/production-shaped-release-verify.mjs` now rejects fallback auth-session source metadata when a production auth session is required.
- `test/production-shaped-proof.test.js` adds a focused regression that proves the checked release verifier fails closed on Playground fallback auth/session source metadata.

Why it does not move the gate:
- This is still checked verifier hardening inside `scripts/playground/*`, not a production-owned real-endpoint command.
- The diff does not prove production auth/session issuance, readback, expiry, rotation, revocation, and cleanup on the real Reprint endpoint.
- The diff does not prove durable restart-readable journal ownership with lease fencing on the live boundary.

Next blocker:
- One checked live `verify:release` run on the real Reprint endpoint must prove auth/session issuance/readback, durable restart-readable journal ownership with lease fencing, preserved rejected remote evidence, and apply-time revalidation before the first mutation on that same boundary.
