# Objective Audit

## Verdict

- Audited commit: `22e1eb7bb37846fb379e6ea7e71a73304235e3da` (`Carry auth identity user id through lifecycle`)
- Previous audited reliable head: `9333de8c20c82959b0acb1ec0ce3ba3173efad5a`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 10:24:50 CEST (+0200)
- Release-classification heads verified before write-up:
  - `origin/lane/reliable-executor` -> `22e1eb7bb37846fb379e6ea7e71a73304235e3da` (`Carry auth identity user id through lifecycle`)
  - `origin/lane/critic` -> `c69e1d64cb9d4589247c49a9051273735c84bb54`
  - `origin/lane/independent-auditor` -> `c58fc99d3aeba8179cd40f50d7a8edf9ac0e2016`
  - `origin/lane/progress-publisher` -> `d047f5f92850aa3c02cfdc9a043430a60b26c9cd`
  - `origin/main` -> `102ccea4dc1ad273d8f04548a80417778bb5ddd2`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Auth identity continuity | `22e1eb7b` now carries `auth.identity.userId` through the checked auth/session lifecycle and fails closed when a preserved read changes that user id. | A production-owned real-endpoint command that actually exercises the live `REPRINT_PUSH_SOURCE_URL` boundary on the checked release path. | Support-only |
| Production auth/session lifecycle | The diff strengthens identity continuity across issued/read/recovery/journal observations, but the checked path still does not prove production issuance, readback, expiry, rotation, revocation, and cleanup on the live endpoint. | One checked real-endpoint command proving issuance, readback, expiry, rotation, revocation, and cleanup on the same production-owned endpoint. | Blocked |
| Durable restart-readable journal ownership | The change keeps using the same harness-owned proof surface and does not add a new production-owned journal primitive or restart-readable live artifact. | Durable journal proof on the real endpoint with lease-fenced ownership and restart-readable recovery outside Playground/package-only scaffolding. | Blocked |
| Live mutation boundary | The patch still stays in auth/session verification logic and test coverage; it does not execute a production-owned mutation path on the real endpoint. | One production-owned, non-lab-backed checked mutation boundary on the real Reprint endpoint. | Blocked |
| Playwright/Playground scope vs production scope | This remains checked-release harness and source-loader logic. It strengthens the failure shape but does not move the proof outside `scripts/playground/*` or packaged verifier scaffolding. | Evidence outside `scripts/playground/*` and packaged verifier scaffolding that the same behavior exists on the real production endpoint. | Blocked |
| Release-boundary proof | The new tests verify stricter `auth.identity.userId` continuity handling across the checked release flow, but they still do not prove the same executable real-endpoint path issues and reads back auth, persists the journal durably with lease fencing, preserves rejected remote evidence, and revalidates before first mutation. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, rejected-remote preservation, and pre-mutation apply-time revalidation. | Blocked |

## Change Assessment

1. `22e1eb7b` is meaningful release-verifier hardening because it now carries `auth.identity.userId` through the checked lifecycle and fails closed on user-id drift or missing user-id evidence.
2. It also improves the checked failure shape by naming the user-id mismatch explicitly instead of only checking login strings.
3. The patch still lives in source-loader and harness-facing verification logic. It does not add a real Reprint source-boundary command that proves live auth/session issuance, durable journal ownership, or apply-time revalidation on the production endpoint.
4. The new tests verify stricter `auth.identity.userId` continuity detection, but they do not prove a production-owned real-endpoint artifact. The release verdict therefore stays at `0/4`.

## Conclusion

`22e1eb7bb37846fb379e6ea7e71a73304235e3da` closes no supervised release gate. It is a narrow checked release-verifier support change that tightens authenticated identity `userId` continuity, but it still leaves the missing production-owned real-endpoint proof unchanged. The verdict remains `0/4`.

The next exact production primitive is still one checked live release command on the real Reprint endpoint that shows:

  - the exact live `REPRINT_PUSH_SOURCE_URL`
  - the same executable auth-session source command at issuance and readback
  - durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership
  - preserved rejected-remote evidence for audit
  - apply-time revalidation before the first mutation on that same live boundary

Until that exists, the release-gate verdict stays `0/4`.
