Audited `349826d919f747c8a3d207a8f39faf9c67e9fa92` (`Fail closed on stale auth session summaries`).

Verdict: `0/4`

What changed:
- `scripts/playground/production-auth-session-lifecycle.js` now fails closed when the top-level lifecycle summary carries invalid boolean flags or invalid direct observation fields before the helper accepts the summary.
- The same helper now cross-checks direct `issued` and `read` summary snapshots against the underlying `observations` trace and rejects stale direct lifecycle data with `stale-issued-summary` or `stale-read-summary`.
- The helper also rejects mismatched direct session ids across the summary and observation trace, tightening continuity checks for production-shaped auth/session lifecycle evidence.
- `test/production-shaped-proof.test.js` adds production-shaped proof cases for stale direct `issued` fields, stale direct `read` fields, and a `preserved` summary missing its phase; each case now fails closed.

Why it does not move the gate:
- This is still fail-closed summary-shape hardening. The executable evidence remains a production-shaped helper and lab-scoped proof tests, not a production-owned real Reprint endpoint.
- For this commit specifically, the stale auth-session lifecycle summary hardening is support-only because it validates summary coherence inside production-shaped/lab-scoped evidence rather than proving live auth/session issuance and readback on the checked release path.
- The diff still does not prove durable restart-readable journal ownership with lease fencing, preserved rejected-remote evidence, or apply-time revalidation before first mutation on a production-owned boundary.

Critic alignment:
- `origin/lane/critic` at `26bee883c453967daa79767603a9b1697c4d060a` classifies this same reliable head at `0/4`, and this audit agrees.

Next blocker:
- One checked live release run on the real Reprint endpoint must still prove live auth/session issuance/readback, durable restart-readable journal ownership with lease fencing, preserved rejected-remote evidence, and apply-time revalidation before the first mutation on that same boundary.
