Audited `3b0df9c2efd16a4f68c907f6843b804dcbd2bbc8` (`Harden live release verify startup retries`).

Verdict: `0/4`

What changed:
- `scripts/playground/production-shaped-live-release-verify.mjs` now retries Playground startup up to three times when port collisions occur and records the bounded readiness failure path before the wrapper can kill the process.
- `test/production-shaped-proof.test.js` updates the bounded release-verify assertions to account for the retryable startup path and the more explicit readiness failure reporting.

Why it does not move the gate:
- This is release-verifier startup hardening, not a production-owned Reprint endpoint proof.
- The change stays inside `scripts/playground/*` and the harness tests; it still does not prove live auth/session issuance and readback on the real source URL.
- It does not add durable restart-readable journal ownership, lease-fenced storage, preserved rejected-remote evidence, or apply-time revalidation on a live production boundary.

Next blocker:
- One checked live release command on the real Reprint endpoint still has to prove live auth/session issuance/readback, durable restart-readable journal ownership with lease fencing, preserved rejected-remote evidence, and apply-time revalidation before the first mutation on that same boundary.
