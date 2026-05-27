# Objective Audit

## Verdict

- Audited commit: `a247efd1044ced53b7139698834ac1088310b251` (`Require journal auth on checked path`)
- Previous audited reliable head: `a86328d648354ec5e29f75145be59c20079c3ba9`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 11:45:09 CEST (+0200)
- Release-classification heads verified before write-up:
  - `origin/lane/reliable-executor` -> `a247efd1044ced53b7139698834ac1088310b251` (`Require journal auth on checked path`)
  - `origin/lane/critic` -> `7616f95aa8061964eba898ddd216777c21089253`
  - `origin/lane/independent-auditor` -> `fab034f07`
  - `origin/lane/progress-publisher` -> `6ec015170c8396d954dd8a10fc300de8dab23c51`
  - `origin/main` -> `f8cc8282a48674298e4573623ddb15dd749db55e`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Journal auth on checked path | `a247efd1` adds a checked-path guard so the journal inspection fails closed when the expected auth envelope is missing. That is useful because it hardens the client-side release-verifier path and prevents an unauthenticated journal read from being treated as acceptable. | A production-owned real-endpoint boundary proving the same live release path actually issues and reads back production auth/session state. | Support-only |
| Durable restart-readable journal ownership | The patch does not add production recovery-journal ownership, lease fencing, or restart-readable replay semantics. It only rejects missing auth-envelope evidence in the checked client path. | Durable journal proof on the real endpoint with lease-fenced ownership and restart-readable recovery outside Playground/package-only scaffolding. | Blocked |
| Live mutation boundary | The change stays in `src/authenticated-http-push-client.js` and its tests. It does not exercise a production-owned mutation path on the real endpoint. | One production-owned, non-lab-backed checked mutation boundary on the real Reprint endpoint. | Blocked |
| Auth/session lifecycle | This commit ensures journal auth evidence is present on the checked path, but it still does not prove production-backed auth issuance/readback/expiry/rotation/revocation/cleanup. | One checked real-endpoint command proving the lifecycle on the same production-owned endpoint. | Blocked |
| Release-boundary proof | The checked client now fails closed when journal auth evidence is missing, but that still does not prove the same executable real-endpoint path mints, reads back, and preserves production auth/session and durable journal state before mutation. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, rejected-remote preservation, and pre-mutation apply-time revalidation. | Blocked |

## Change Assessment

1. `a247efd1` is useful support because it makes the checked journal-inspection path fail closed when the auth envelope is absent.
2. It does not exercise a real Reprint source boundary, so it cannot prove live auth/session issuance, durable journal ownership on the real endpoint, or apply-time revalidation on the production endpoint.
3. The change lives in `src/authenticated-http-push-client.js` and `test/authenticated-http-push-client.test.js`. It tightens the checked surface, but it does not consume a live `REPRINT_PUSH_SOURCE_URL` or prove the production-owned mutation boundary.
4. The tests now validate the missing-auth-envelope path, but they do not prove a production-owned real-endpoint artifact. The release verdict therefore stays at `0/4`.

## Conclusion

`a247efd1044ced53b7139698834ac1088310b251` closes no supervised release gate. It is a checked support expansion for auth-envelope handling in the journal inspection path, but it still leaves the missing production-owned real-endpoint proof unchanged. The verdict remains `0/4`.

The next exact production primitive is still one checked live release command on the real Reprint endpoint that shows:

  - the exact live `REPRINT_PUSH_SOURCE_URL`
  - the same executable auth-session source command at issuance and readback
  - durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership
  - preserved rejected remote evidence for audit
  - apply-time revalidation before the first mutation on that same live boundary

Until that exists, the release-gate verdict stays at `0/4`.
