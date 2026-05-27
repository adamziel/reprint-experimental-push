# Objective Audit

## Verdict

- Audited commit: `593d9015f061ff5b483837c049362abbb5fefd0d` (`Fail closed on replay auth user id drift`)
- Previous audited reliable head: `a86328d648354ec5e29f75145be59c20079c3ba9`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 11:42:10 CEST (+0200)
- Release-classification heads verified before write-up:
  - `origin/lane/reliable-executor` -> `593d9015f061ff5b483837c049362abbb5fefd0d` (`Fail closed on replay auth user id drift`)
  - `origin/lane/critic` -> `7616f95aa8061964eba898ddd216777c21089253`
  - `origin/lane/independent-auditor` -> `fab034f07`
  - `origin/lane/progress-publisher` -> `6ec015170c8396d954dd8a10fc300de8dab23c51`
  - `origin/main` -> `f8cc8282a48674298e4573623ddb15dd749db55e`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Replay/auth identity drift handling | `593d9015` adds a replay-time guard so the release verifier fails closed if the authenticated identity `userId` changes between apply and replay. That is useful checked-client hardening because it tightens `summarizeReplayEquivalence(...)` and the replay mismatch reporting. | A production-owned real-endpoint boundary, not just checked-client replay identity drift detection inside `src/authenticated-http-push-client.js` and its tests. | Support-only |
| Durable restart-readable journal ownership | The patch does not change recovery-journal ownership, lease fencing, or restart-readable replay semantics. It only narrows replay equivalence to reject identity drift. | Durable journal proof on the real endpoint with lease-fenced ownership and restart-readable recovery outside Playground/package-only scaffolding. | Blocked |
| Live mutation boundary | The change stays in the checked client and test harness. It does not exercise a production-owned mutation path on the real endpoint. | One production-owned, non-lab-backed checked mutation boundary on the real Reprint endpoint. | Blocked |
| Auth/session lifecycle | This commit does not add production-backed auth issuance/readback/expiry/rotation/revocation/cleanup. It only compares replay identity fields on the checked path. | One checked real-endpoint command proving the lifecycle on the same production-owned endpoint. | Blocked |
| Release-boundary proof | The checked client now fails closed on replay auth `userId` drift, but that still does not prove the same executable real-endpoint path issues and reads back auth, persists the journal durably with lease fencing, preserves rejected remote evidence, and revalidates before first mutation. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, rejected-remote preservation, and pre-mutation apply-time revalidation. | Blocked |

## Change Assessment

1. `593d9015` is useful support because it makes replay equivalence stricter by comparing normalized authenticated `userId` values and reporting them as a mismatch when they drift.
2. It does not exercise a real Reprint source boundary, so it cannot prove live auth/session issuance, durable journal ownership on the real endpoint, or apply-time revalidation on the production endpoint.
3. The change lives in `src/authenticated-http-push-client.js` and `test/authenticated-http-push-client.test.js`. It tightens the checked surface, but it does not consume a live `REPRINT_PUSH_SOURCE_URL` or prove the production-owned mutation boundary.
4. The tests now validate the replay auth `userId` drift path, but they do not prove a production-owned real-endpoint artifact. The release verdict therefore stays at `0/4`.

## Conclusion

`593d9015f061ff5b483837c049362abbb5fefd0d` closes no supervised release gate. It is a checked support expansion for replay auth identity drift handling, but it still leaves the missing production-owned real-endpoint proof unchanged. The verdict remains `0/4`.

The next exact production primitive is still one checked live release command on the real Reprint endpoint that shows:

  - the exact live `REPRINT_PUSH_SOURCE_URL`
  - the same executable auth-session source command at issuance and readback
  - durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership
  - preserved rejected remote evidence for audit
  - apply-time revalidation before the first mutation on that same live boundary

Until that exists, the release-gate verdict stays at `0/4`.
