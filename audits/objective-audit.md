# Objective Audit

## Verdict

- Audited commit: `4af801626e072cd724c4a3e24693ce57cecacece` (`Accept apply revalidation plan evidence`)
- Previous audited reliable head: `3c946a8646c776535acb70e88d24df579568ff63`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 11:28:23 CEST (+0200)
- Release-classification heads verified before write-up:
  - `origin/lane/reliable-executor` -> `4af801626e072cd724c4a3e24693ce57cecacece` (`Accept apply revalidation plan evidence`)
  - `origin/lane/critic` -> `444ef9545123acc1f5194d35b79fab6aae8cd8ad`
  - `origin/lane/independent-auditor` -> `435a7907164e859838907b970e5faab8d7bf3184`
  - `origin/lane/progress-publisher` -> `879dc0da475b090217e645e7ab0031ffbc7081e6`
  - `origin/main` -> `6565c54d17999564c08684c70c43d9032df0203c`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Apply-revalidation plan evidence | `4af8016` adds `summarizePlanEvidenceForApplyRevalidation()` and teaches the client to accept `preconditionSetHash` / `mutationSetHash` from plan evidence when they are not present on the receipt. The tests now build matching plan evidence so the checked surface goes green. | A production-owned release boundary that proves the same executable live command on the real Reprint endpoint, not just local plan-evidence acceptance inside the checked client surface. | Support-only |
| Durable restart-readable journal ownership | This commit does not alter recovery-journal ownership or restart-readable replay semantics. | Durable journal proof on the real endpoint with lease-fenced ownership and restart-readable recovery outside Playground/package-only scaffolding. | Blocked |
| Live mutation boundary | The change stays in `src/authenticated-http-push-client.js` and `test/authenticated-http-push-client.test.js`; it does not exercise a production-owned mutation path on the real endpoint. | One production-owned, non-lab-backed checked mutation boundary on the real Reprint endpoint. | Blocked |
| Auth/session lifecycle | This commit does not change auth issuance/readback/expiry/rotation/revocation/cleanup behavior. | One checked real-endpoint command proving the lifecycle on the same production-owned endpoint. | Blocked |
| Release-boundary proof | The checked client now accepts plan evidence for apply revalidation, but that still does not prove the same executable real-endpoint path issues and reads back auth, persists the journal durably with lease fencing, preserves rejected remote evidence, and revalidates before first mutation. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, rejected-remote preservation, and pre-mutation apply-time revalidation. | Blocked |

## Change Assessment

1. `4af8016` is useful support because it lets the checked client accept apply-revalidation plan evidence when the receipt omits matching hashes.
2. It does not exercise a real Reprint source boundary, so it cannot prove live auth/session issuance, durable journal ownership on the real endpoint, or apply-time revalidation on the production endpoint.
3. The change lives under `src/authenticated-http-push-client.js` and `test/authenticated-http-push-client.test.js`. Those files tighten the checked surface, but they do not consume a live `REPRINT_PUSH_SOURCE_URL` or prove the production-owned mutation boundary.
4. The tests now validate plan-evidence acceptance, but they do not prove a production-owned real-endpoint artifact. The release verdict therefore stays at `0/4`.

## Conclusion

`4af801626e072cd724c4a3e24693ce57cecacece` closes no supervised release gate. It is a checked support expansion for apply-revalidation plan evidence, but it still leaves the missing production-owned real-endpoint proof unchanged. The verdict remains `0/4`.

The next exact production primitive is still one checked live release command on the real Reprint endpoint that shows:

  - the exact live `REPRINT_PUSH_SOURCE_URL`
  - the same executable auth-session source command at issuance and readback
  - durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership
  - preserved rejected-remote evidence for audit
  - apply-time revalidation before the first mutation on that same live boundary

Until that exists, the release-gate verdict stays at `0/4`.
