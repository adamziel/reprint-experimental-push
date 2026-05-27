# Objective Audit

## Verdict

- Audited commit: `368b7e74834ddf2e7289fa73a944d569e636e11f` (`Fail closed on fallback auth session sources`)
- Previous audited reliable head: `405d464a2b00df1f3712e83f5f463918f6b760`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 10:53:27 CEST (+0200)
- Release-classification heads verified before write-up:
  - `origin/lane/reliable-executor` -> `368b7e74834ddf2e7289fa73a944d569e636e11f` (`Fail closed on fallback auth session sources`)
  - `origin/lane/critic` -> `f0a1f0e4402894eb122b55990b7af2965a4a191c`
  - `origin/lane/independent-auditor` -> `77ea754bc74a29f577b2e3d33f8ec238648e4db5`
  - `origin/lane/progress-publisher` -> `d7bea6aef63871d47799677cee88d859b819b560`
  - `origin/main` -> `6971f4be183b2b1e2d146f4d55173686f05f7e67`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Fallback auth-session source rejection | `368b7e74` adds fail-closed handling for fallback auth-session source metadata inside the checked release verifier and a matching regression test. | A production-owned real-endpoint command that actually exercises the live `REPRINT_PUSH_SOURCE_URL` boundary on the checked release path. | Support-only |
| Production auth/session lifecycle | The diff still does not prove production issuance, readback, expiry, rotation, revocation, and cleanup on the live endpoint. | One checked real-endpoint command proving issuance, readback, expiry, rotation, revocation, and cleanup on the same production-owned endpoint. | Blocked |
| Durable restart-readable journal ownership | The change does not add a new production-owned restart-readable live artifact or durable journal consumer. | Durable journal proof on the real endpoint with lease-fenced ownership and restart-readable recovery outside Playground/package-only scaffolding. | Blocked |
| Live mutation boundary | The patch still stays in `scripts/playground/production-shaped-release-verify.mjs` and tests; it does not execute a production-owned mutation path on the real endpoint. | One production-owned, non-lab-backed checked mutation boundary on the real Reprint endpoint. | Blocked |
| Playwright/Playground scope vs production scope | This remains checked-release harness and source-loader logic. It strengthens fallback rejection but does not move the proof outside `scripts/playground/*` or packaged verifier scaffolding. | Evidence outside `scripts/playground/*` and packaged verifier scaffolding that the same behavior exists on the real production endpoint. | Blocked |
| Release-boundary proof | The new test verifies fallback auth-session source rejection, but it does not prove the same executable real-endpoint path issues and reads back auth, persists the journal durably with lease fencing, preserves rejected remote evidence, and revalidates before first mutation. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, rejected-remote preservation, and pre-mutation apply-time revalidation. | Blocked |

## Change Assessment

1. `368b7e74` is meaningful checked verifier hardening because it rejects fallback auth-session source metadata inside the release verifier.
2. It also adds fail-closed coverage for a Playground fallback source path.
3. The patch still lives inside `scripts/playground/production-shaped-release-verify.mjs` and focused tests. It does not add a real Reprint source-boundary command that proves live auth/session issuance, durable journal ownership on the real endpoint, or apply-time revalidation on the production endpoint.
4. The new tests verify fallback-source rejection, but they do not prove a production-owned real-endpoint artifact. The release verdict therefore stays at `0/4`.

## Conclusion

`368b7e74834ddf2e7289fa73a944d569e636e11f` closes no supervised release gate. It is a checked fallback-auth-session-source rejection change, but it still leaves the missing production-owned real-endpoint proof unchanged. The verdict remains `0/4`.

The next exact production primitive is still one checked live release command on the real Reprint endpoint that shows:

  - the exact live `REPRINT_PUSH_SOURCE_URL`
  - the same executable auth-session source command at issuance and readback
  - durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership
  - preserved rejected-remote evidence for audit
  - apply-time revalidation before the first mutation on that same live boundary

Until that exists, the release-gate verdict stays `0/4`.
