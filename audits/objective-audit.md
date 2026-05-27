# Objective Audit

## Verdict

- Audited commit: `a86328d648354ec5e29f75145be59c20079c3ba9` (`Keep final retry evidence for preserved reads`)
- Previous audited reliable head: `bf495d928e18a1021ff2401b44b503ffbc97cd01`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 11:39:29 CEST (+0200)
- Release-classification heads verified before write-up:
  - `origin/lane/reliable-executor` -> `a86328d648354ec5e29f75145be59c20079c3ba9` (`Keep final retry evidence for preserved reads`)
  - `origin/lane/critic` -> `7616f95aa8061964eba898ddd216777c21089253`
  - `origin/lane/independent-auditor` -> `bfb6020c5b57c8553a6abcd2868f059367eab256`
  - `origin/lane/progress-publisher` -> `6ec015170c8396d954dd8a10fc300de8dab23c51`
  - `origin/main` -> `f8cc8282a48674298e4573623ddb15dd749db55e`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Preserved-read retry boundary | `a86328d6` keeps the preserved-read retry evidence available by preferring `latestReadRetryEvidence` when the release verifier re-reads the same path after retry. That is stronger checked-client evidence, but it still lives inside `src/authenticated-http-push-client.js` and its tests. | A production-owned release boundary on the real Reprint endpoint, not just local retry classification inside the checked client surface. | Support-only |
| Durable restart-readable journal ownership | This commit does not change recovery-journal ownership or restart-readable replay semantics; it only improves how the checked client remembers the last retry evidence for preserved reads. | Durable journal proof on the real endpoint with lease-fenced ownership and restart-readable recovery outside Playground/package-only scaffolding. | Blocked |
| Live mutation boundary | The change stays in the checked client and test harness. It does not exercise a production-owned mutation path on the real endpoint. | One production-owned, non-lab-backed checked mutation boundary on the real Reprint endpoint. | Blocked |
| Auth/session lifecycle | This commit does not change auth issuance/readback/expiry/rotation/revocation/cleanup behavior. | One checked real-endpoint command proving the lifecycle on the same production-owned endpoint. | Blocked |
| Release-boundary proof | The checked client now retains final retry evidence for preserved reads, but that still does not prove the same executable real-endpoint path issues and reads back auth, persists the journal durably with lease fencing, preserves rejected remote evidence, and revalidates before first mutation. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, rejected-remote preservation, and pre-mutation apply-time revalidation. | Blocked |

## Change Assessment

1. `a86328d6` is useful support because it preserves the final retry evidence for read retry paths after journal fallback.
2. It does not exercise a real Reprint source boundary, so it cannot prove live auth/session issuance, durable journal ownership on the real endpoint, or apply-time revalidation on the production endpoint.
3. The change lives in `src/authenticated-http-push-client.js` and `test/authenticated-http-push-client.test.js`. It tightens the checked surface, but it does not consume a live `REPRINT_PUSH_SOURCE_URL` or prove the production-owned mutation boundary.
4. The tests now validate the preserved-read retry evidence path, but they do not prove a production-owned real-endpoint artifact. The release verdict therefore stays at `0/4`.

## Conclusion

`a86328d648354ec5e29f75145be59c20079c3ba9` closes no supervised release gate. It is a checked support expansion for preserved-read retry evidence, but it still leaves the missing production-owned real-endpoint proof unchanged. The verdict remains `0/4`.

The next exact production primitive is still one checked live release command on the real Reprint endpoint that shows:

  - the exact live `REPRINT_PUSH_SOURCE_URL`
  - the same executable auth-session source command at issuance and readback
  - durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership
  - preserved rejected-remote evidence for audit
  - apply-time revalidation before the first mutation on that same live boundary

Until that exists, the release-gate verdict stays at `0/4`.
