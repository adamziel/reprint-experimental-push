# Objective Audit

## Verdict

- Audited commit: `b8f2b23af24c3bc3ab6faa91c490a2bb550d53a8` (`Pin live apply timeout retry`)
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 03:52:31 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `66afff2b1da3e83018f04d9ece3e42d46cab7f92` (`Narrow packaged driver proof helper`)
  - `origin/lane/critic` -> `aaf55a59b5006f88ab0cc47485d07e15ad69870e` (`Classify retry timeout wrapper proof`)
  - `origin/lane/independent-auditor` -> `c7eef48d25e16fd48d9941f4f772b47854ae265d` (`Audit reliable head c2a70e1f`)
  - `origin/lane/progress-publisher` -> `51636064019c9ca0a81bfec2aa491928fa28327c` (`Refresh progress for c2a70e1f`)
  - `origin/main` -> `fb313455efba84627ca33402dd32e8992e5be904` (`Refresh live progress page`)

`b8f2b23a` was the requested reliable head to audit, but it was no longer the live `origin/lane/reliable-executor` tip by the time this audit completed. This file audits `b8f2b23a` explicitly and records the newer remote-tip mismatch rather than preserving stale `a1ca1eff` remote-head lines.

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Live mutation boundary | The checked verifier still proves only Playground/package-mode behavior. No new evidence in `b8f2b23a` exercises a production-owned mutation boundary on the real Reprint endpoint. | One production-owned, non-lab-backed source mutation boundary proving the real endpoint is safe before and during mutation. | Blocked |
| Production auth/session lifecycle | `c2a70e1f` already improved proof integrity by routing the apply-revalidation leg through the same runtime `REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND`. `b8f2b23a` does not extend that surface; it only unit-tests one retry classifier branch. | One checked production command on the real source URL where the same executable command mints and then reads back a live auth session on that exact live boundary. | Blocked |
| Durable restart-readable journal ownership | The retained `a1ca1eff` bounded wrapper run remains support evidence for `ownsJournal: true`, `restartReadable: true`, and `staleClaimRejected: true`, but it is still emitted by the packaged combined verifier path. `b8f2b23a` adds no new live-source journal proof. | Production-owned durable journal evidence on the real endpoint, with lease-fenced ownership and restart-readable behavior outside Playground/package-mode scaffolding. | Blocked |
| Apply-time revalidation before first mutation | The retained `a1ca1eff` combined proof still shows the expected apply-time `PRECONDITION_FAILED` recovery block. `b8f2b23a` only proves, with a focused unit test, that the wrapper classifies one `apply-revalidation: apply /apply` plus `TimeoutError` failure shape as retryable. | A real-endpoint checked proof that apply-time revalidation runs before the first mutation on the production-owned boundary, not just that a wrapper retries a simulated timeout. | Blocked |
| Wrapper retry hardening | `a1ca1eff` broadened the wrapper so a child run that reaches `apply-revalidation: apply /apply` and then aborts with `TimeoutError: The operation was aborted due to timeout` is retried. `b8f2b23a` extracts that classifier into `scripts/playground/production-shaped-live-release-verify-lib.js` and adds a focused unit test plus a negative case without the `apply-revalidation:` marker. | Proof that this retry behavior closes a supervised release gate rather than only reducing verifier flake inside the packaged wrapper. | Support-only |
| Release-boundary proof | The best retained support run is still the earlier bounded `timeout 210s ... node scripts/playground/production-shaped-live-release-verify.mjs` result from `a1ca1eff`, which exited `0` and emitted `PACKAGED_RELEASE_BOUNDARY_OK`, `replayAndRetry.retryAttempts: 2`, production auth-session evidence, durable-journal ownership/restart-readable evidence, `staleClaimRejected: true`, and the apply-revalidation recovery block. `b8f2b23a` does not replace that with a stronger primitive. | One production-owned, non-lab-backed checked release boundary on the real Reprint endpoint using the same executable command for auth issuance, auth readback, journal persistence, rejected-remote preservation, and apply-time revalidation. | Blocked |

## Change Assessment

1. The `a1ca1eff..b8f2b23a` diff is intentionally narrow. It creates `scripts/playground/production-shaped-live-release-verify-lib.js`, moves `applyRevalidationRetryable()` out of `scripts/playground/production-shaped-live-release-verify.mjs`, and adds one focused unit test in `test/production-shaped-proof.test.js`.
2. The new unit test is useful. It pins the exact retry branch where stderr contains `apply-revalidation: apply /apply` and `TimeoutError: The operation was aborted due to timeout`, and it adds a negative case proving a bare timeout without the apply-revalidation marker is not retried.
3. That focused test is still support-only. It proves that the wrapper keeps the `a1ca1eff` retry rule wired after refactoring, but it does not create new evidence about the supervised production objective. The only end-to-end success evidence remains the earlier packaged combined verifier run from `a1ca1eff`.
4. No supervised gate moves on this follow-up. The missing primitive is unchanged: a real Reprint endpoint proof where the same visible command and exact live `REPRINT_PUSH_SOURCE_URL` mint a live auth session, read that session back, persist it in a durable restart-readable journal with lease-fenced ownership, preserve rejected-remote evidence for audit, and perform apply-time revalidation before the first mutation.

## Conclusion

`b8f2b23a` is a regression-test follow-up to `a1ca1eff`, not a new release-boundary proof. It successfully locks in one previously added retry classifier branch, but the audited evidence still terminates inside the same packaged combined verifier path. Because the production-owned source boundary is still missing, the release verdict remains `0/4`.

The next exact production primitive is one checked live release command on the real Reprint endpoint where the emitted proof shows:

- the exact live `REPRINT_PUSH_SOURCE_URL`
- the same executable auth-session source command string at issuance and readback
- durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership
- preserved rejected-remote evidence for audit
- apply-time revalidation occurring before the first mutation on that same live boundary

The focused regression test beyond wrapper retry hardening should pin that primitive directly: fail unless one real-endpoint proof artifact contains those fields together, and fail if the auth command, live source URL, rejected-remote evidence, journal ownership/readback evidence, or pre-mutation apply-revalidation marker drift or disappear.
