# Objective Audit

## Verdict

- Audited commit: `a7e1a4c340492635a0354d7d68be19fda750ed43` (`Tighten strict auth session id drift`)
- Previous audited reliable head: `da1e1233341d0a4b3d6440839cefd948eb7d11a9`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 10:13:13 CEST (+0200)
- Release-classification heads verified before write-up:
  - `origin/lane/reliable-executor` -> `a7e1a4c340492635a0354d7d68be19fda750ed43` (`Tighten strict auth session id drift`)
  - `origin/lane/critic` -> `1a73173521cc3490c44cd75cbca94f19cf707eda`
  - `origin/lane/independent-auditor` -> `1cf93d6c3b468eafde7bc9addc02456ec5801167`
  - `origin/lane/progress-publisher` -> `d3fa417f6071f1f924487cd23beb66ce8bcd30cf`
  - `origin/main` -> `a6f611ea7381c71d7795ffc451b81508c7b85578`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Packaged boundary openness | `a7e1a4c3` is still release-verifier hardening on the checked auth/session path. It adds stricter session-id drift checks, but it remains inside the harness and does not create a real production boundary. | A production-owned real-endpoint command that actually exercises the live `REPRINT_PUSH_SOURCE_URL` boundary on the checked release path. | Support-only |
| Production auth/session lifecycle | The diff adds stricter session-id drift detection for preflight, dry-run, apply, and recovery-inspect, but the checked path still does not prove production issuance, readback, expiry, rotation, revocation, and cleanup on the live endpoint. | One checked real-endpoint command proving issuance, readback, expiry, rotation, revocation, and cleanup on the same production-owned endpoint. | Blocked |
| Durable restart-readable journal ownership | The change keeps using the same harness-owned proof surface and does not add a new production-owned journal primitive or restart-readable live artifact. | Durable journal proof on the real endpoint with lease-fenced ownership and restart-readable recovery outside Playground/package-only scaffolding. | Blocked |
| Live mutation boundary | The patch still stays in auth/session verification logic and test coverage; it does not execute a production-owned mutation path on the real endpoint. | One production-owned, non-lab-backed checked mutation boundary on the real Reprint endpoint. | Blocked |
| Playwright/Playground scope vs production scope | This remains checked-release harness and source-loader logic. It strengthens the failure shape but does not move the proof outside `scripts/playground/*` or packaged verifier scaffolding. | Evidence outside `scripts/playground/*` and packaged verifier scaffolding that the same behavior exists on the real production endpoint. | Blocked |
| Release-boundary proof | The new tests verify stricter session-id drift handling across the checked release flow, but they still do not prove the same executable real-endpoint path issues and reads back auth, persists the journal durably with lease fencing, preserves rejected remote evidence, and revalidates before first mutation. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, rejected-remote preservation, and pre-mutation apply-time revalidation. | Blocked |

## Change Assessment

1. `a7e1a4c3` is meaningful release-verifier hardening because it tightens auth session id drift handling across preflight, dry-run, apply, and recovery-inspect.
2. It also improves the checked failure shape by naming the session-id mismatch directly instead of only a generic preserved-read drift.
3. The patch still lives in source-loader and harness-facing verification logic. It does not add a real Reprint source-boundary command that proves live auth/session issuance, durable journal ownership, or apply-time revalidation on the production endpoint.
4. The new tests verify stricter drift detection, but they do not prove a production-owned real-endpoint artifact. The release verdict therefore stays at `0/4`.

## Conclusion

`a7e1a4c340492635a0354d7d68be19fda750ed43` closes no supervised release gate. It is a narrow checked release-verifier support change that tightens auth session id drift handling, but it still leaves the missing production-owned real-endpoint proof unchanged. The verdict remains `0/4`.

The next exact production primitive is still one checked live release command on the real Reprint endpoint that shows:

  - the exact live `REPRINT_PUSH_SOURCE_URL`
  - the same executable auth-session source command at issuance and readback
  - durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership
  - preserved rejected-remote evidence for audit
  - apply-time revalidation before the first mutation on that same live boundary

Until that exists, the release-gate verdict stays `0/4`.
