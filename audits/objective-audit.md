# Objective Audit

## Verdict

- Audited commit: `e9a7b19ac4ac3dad32c1672712f6825946632818` (`Fence inherited durable claim markers`)
- Previous audited reliable head: `22e1eb7bb37846fb379e6ea7e71a73304235e3da`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 10:30:03 CEST (+0200)
- Release-classification heads verified before write-up:
  - `origin/lane/reliable-executor` -> `e9a7b19ac4ac3dad32c1672712f6825946632818` (`Fence inherited durable claim markers`)
  - `origin/lane/critic` -> `c0a38e934974a2bfabdec693cb44e7560804e062`
  - `origin/lane/independent-auditor` -> `12543e8253d11f882c0a482a0ee78e12f39446f3`
  - `origin/lane/progress-publisher` -> `9f772222e793fe2f9b7515e41ccb143d572e7bc1`
  - `origin/main` -> `e43c95808771c29dc6c54a0133ad09de344afaa2`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Auth identity continuity | `22e1eb7b` now carries `auth.identity.userId` through the checked auth/session lifecycle and fails closed when a preserved read changes that user id. | A production-owned real-endpoint command that actually exercises the live `REPRINT_PUSH_SOURCE_URL` boundary on the checked release path. | Support-only |
| Production auth/session lifecycle | The diff tightens inherited durable-claim markers inside the checked recovery-journal path, but it still does not prove production issuance, readback, expiry, rotation, revocation, and cleanup on the live endpoint. | One checked real-endpoint command proving issuance, readback, expiry, rotation, revocation, and cleanup on the same production-owned endpoint. | Blocked |
| Durable restart-readable journal ownership | The change fences inherited durable claim markers and hardens stale-claim rejection in the checked journal surface, but it still stays inside harness-owned proof and does not add a new production-owned restart-readable live artifact. | Durable journal proof on the real endpoint with lease-fenced ownership and restart-readable recovery outside Playground/package-only scaffolding. | Blocked |
| Live mutation boundary | The patch still stays in auth/session verification logic and test coverage; it does not execute a production-owned mutation path on the real endpoint. | One production-owned, non-lab-backed checked mutation boundary on the real Reprint endpoint. | Blocked |
| Playwright/Playground scope vs production scope | This remains checked-release harness and source-loader logic. It strengthens durable claim-marker inheritance checks but does not move the proof outside `scripts/playground/*` or packaged verifier scaffolding. | Evidence outside `scripts/playground/*` and packaged verifier scaffolding that the same behavior exists on the real production endpoint. | Blocked |
| Release-boundary proof | The new tests verify inherited durable-claim fencing and stale-claim rejection handling across the checked recovery-journal flow, but they still do not prove the same executable real-endpoint path issues and reads back auth, persists the journal durably with lease fencing, preserves rejected remote evidence, and revalidates before first mutation. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, rejected-remote preservation, and pre-mutation apply-time revalidation. | Blocked |

## Change Assessment

1. `e9a7b19a` is meaningful checked recovery-journal hardening because it rejects inherited durable claim markers, requires own-properties claim summaries, and tightens stale-claim fencing in the journal boundary checks.
2. It also improves the checked failure shape by ensuring claim markers cannot be inherited through the journal summary object prototype chain.
3. The patch still lives inside `src/recovery-journal.js` and focused recovery-journal tests. It does not add a real Reprint source-boundary command that proves live auth/session issuance, durable journal ownership on the real endpoint, or apply-time revalidation on the production endpoint.
4. The new tests verify inherited durable-claim marker rejection, but they do not prove a production-owned real-endpoint artifact. The release verdict therefore stays at `0/4`.

## Conclusion

`e9a7b19ac4ac3dad32c1672712f6825946632818` closes no supervised release gate. It is a narrow checked recovery-journal support change that tightens inherited durable claim marker handling, but it still leaves the missing production-owned real-endpoint proof unchanged. The verdict remains `0/4`.

The next exact production primitive is still one checked live release command on the real Reprint endpoint that shows:

  - the exact live `REPRINT_PUSH_SOURCE_URL`
  - the same executable auth-session source command at issuance and readback
  - durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership
  - preserved rejected-remote evidence for audit
  - apply-time revalidation before the first mutation on that same live boundary

Until that exists, the release-gate verdict stays `0/4`.
