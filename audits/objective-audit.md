# Objective Audit

## Verdict

- Audited commit: `35dc26ec1d3536ef1aabfa57c31f1ed1e02c6317` (`Honor matching runtime auth request state`)
- Previous audited reliable head: `c544a31336ca6c81e0a47b15cfe846f9eaf7794c`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 11:10:01 CEST (+0200)
- Release-classification heads verified before write-up:
  - `origin/lane/reliable-executor` -> `35dc26ec1d3536ef1aabfa57c31f1ed1e02c6317` (`Honor matching runtime auth request state`)
  - `origin/lane/critic` -> `977b4e4b90eaf0ee20c9418da6d6c8e42b710f44`
  - `origin/lane/independent-auditor` -> `6e79d0b5e8b1ef5caa3465af30732c4c1af432ff`
  - `origin/lane/progress-publisher` -> `9404670156a3be6fd0d4caee125fff27b6d93626`
  - `origin/main` -> `0394cf10f63ca5f3713ef0e6df662f8bb2b6de5d`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Runtime auth request state matching | `35dc26ec` teaches the release verifier to honor matching runtime auth request state from explicit remote/local candidates and adds a focused assertion for that resolution path. | A production-owned real-endpoint command that actually exercises the live `REPRINT_PUSH_SOURCE_URL` boundary on the checked release path. | Support-only |
| Production auth/session lifecycle | The diff still does not prove production issuance, readback, expiry, rotation, revocation, and cleanup on the live endpoint. | One checked real-endpoint command proving issuance, readback, expiry, rotation, revocation, and cleanup on the same production-owned endpoint. | Blocked |
| Durable restart-readable journal ownership | The change does not add a new production-owned restart-readable live artifact or durable journal consumer. | Durable journal proof on the real endpoint with lease-fenced ownership and restart-readable recovery outside Playground/package-only scaffolding. | Blocked |
| Live mutation boundary | The patch still stays in `scripts/playground/auth-session-source.js`, `scripts/playground/production-shaped-release-verify.mjs`, and a focused proof test; it does not execute a production-owned mutation path on the real endpoint. | One production-owned, non-lab-backed checked mutation boundary on the real Reprint endpoint. | Blocked |
| Auth source topology vs production scope | This remains auth-request-state and runtime source-resolution logic. It strengthens matching between explicit runtime candidates and the requested auth source, but it does not move the proof outside support-side verifier scaffolding. | Evidence outside verifier scaffolding that the same behavior exists on the real production endpoint. | Blocked |
| Release-boundary proof | The new test verifies runtime auth request-state matching, but it does not prove the same executable real-endpoint path issues and reads back auth, persists the journal durably with lease fencing, preserves rejected remote evidence, and revalidates before first mutation. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, rejected-remote preservation, and pre-mutation apply-time revalidation. | Blocked |

## Change Assessment

1. `35dc26ec` is meaningful runtime auth-request-state hardening because it lets the release verifier honor matching explicit runtime candidates and preserves that path in focused proof tests.
2. It also clarifies that explicit remote/local runtime candidates can match the requested auth source without falling back to stale packaged defaults.
3. The patch still lives inside `scripts/playground/auth-session-source.js`, `scripts/playground/production-shaped-release-verify.mjs`, and a focused proof test. It does not add a real Reprint source-boundary command that proves live auth/session issuance, durable journal ownership on the real endpoint, or apply-time revalidation on the production endpoint.
4. The new tests verify runtime auth request-state matching, but they do not prove a production-owned real-endpoint artifact. The release verdict therefore stays at `0/4`.

## Conclusion

`35dc26ec1d3536ef1aabfa57c31f1ed1e02c6317` closes no supervised release gate. It is a checked runtime auth-request-state expansion, but it still leaves the missing production-owned real-endpoint proof unchanged. The verdict remains `0/4`.

The next exact production primitive is still one checked live release command on the real Reprint endpoint that shows:

  - the exact live `REPRINT_PUSH_SOURCE_URL`
  - the same executable auth-session source command at issuance and readback
  - durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership
  - preserved rejected-remote evidence for audit
  - apply-time revalidation before the first mutation on that same live boundary

Until that exists, the release-gate verdict stays `0/4`.
