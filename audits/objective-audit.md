# Objective Audit

## Verdict

- Audited commit: `d8bfe95164e1ba2df1dcf78d5310207176e74942` (`Fail closed on hidden auth session revocation drift`)
- Previous audited reliable head: `a247efd1044ced53b7139698834ac1088310b251`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 11:52:36 CEST (+0200)
- Release-classification heads verified before write-up:
  - `origin/lane/reliable-executor` -> `d8bfe95164e1ba2df1dcf78d5310207176e74942` (`Fail closed on hidden auth session revocation drift`)
  - `origin/lane/critic` -> `7616f95aa8061964eba898ddd216777c21089253`
  - `origin/lane/independent-auditor` -> `fab034f07`
  - `origin/lane/progress-publisher` -> `6ec015170c8396d954dd8a10fc300de8dab23c51`
  - `origin/main` -> `f8cc8282a48674298e4573623ddb15dd749db55e`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Auth/session revocation drift on the checked path | `d8bfe951` makes the checked client fail closed when hidden revocation-state drift is observed, and the focused tests cover the new refusal path in `src/authenticated-http-push-client.js` and `test/authenticated-http-push-client.test.js`. | A production-owned real-endpoint boundary proving issuance, readback, expiry, rotation, revocation, cleanup, and replay rejection on the same executable release path. | Support-only |
| Durable restart-readable journal ownership | The commit does not add durable-journal ownership, lease fencing, restart-readable replay, or production storage consumption. | One checked real-endpoint command that proves the release path consumes durable journal ownership with restart-readable artifacts and lease-fenced state. | Blocked |
| Live mutation boundary | The change stays inside the checked client and its tests. It does not exercise a production-owned mutation path on the real Reprint endpoint. | One production-owned, non-lab-backed checked mutation boundary on the real source URL. | Blocked |
| Auth/session lifecycle | The new guard rejects hidden revocation drift, but it still does not prove the full production lifecycle or a live source boundary. | Production-backed auth/session issuance/readback/expiry/rotation/revocation/cleanup on the checked release path. | Blocked |
| Release-boundary proof | The checked path now fails closed on hidden auth-session revocation drift, but it still does not prove the same executable real-endpoint path owns the live source, preserved remote evidence, and pre-mutation revalidation. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, rejected-remote preservation, and apply-time revalidation. | Blocked |

## Change Assessment

1. `d8bfe951` is useful support because it makes the checked auth/session path fail closed when hidden revocation drift appears.
2. It does not exercise a real Reprint source boundary, so it cannot prove live auth/session issuance, durable journal ownership on the real endpoint, or apply-time revalidation on the production boundary.
3. The change lives in `src/authenticated-http-push-client.js` and `test/authenticated-http-push-client.test.js`. It tightens the checked surface, but it does not consume a live `REPRINT_PUSH_SOURCE_URL`.
4. The tests now validate the hidden-revocation refusal path, but they do not prove a production-owned real-endpoint artifact. The release verdict therefore stays at `0/4`.

## Conclusion

`d8bfe95164e1ba2df1dcf78d5310207176e74942` closes no supervised release gate. It is a checked support expansion for auth-session revocation drift handling, but it still leaves the missing production-owned real-endpoint proof unchanged. The verdict remains `0/4`.

The next exact production primitive is still one checked live release command on the real Reprint endpoint that shows:

- the exact live `REPRINT_PUSH_SOURCE_URL`
- the same executable auth-session source command at issuance and readback
- durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership
- preserved rejected remote evidence for audit
- apply-time revalidation before the first mutation on that same live boundary

Until that exists, the release-gate verdict stays at `0/4`.
