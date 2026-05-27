# Objective Audit

## Verdict

- Audited commit: `9fed3c4937c85da6c2bdca69d1a0341d837bdf52` (`Map safe comment graph edges and live proof`)
- Previous audited reliable head: `d8bfe95164e1ba2df1dcf78d5310207176e74942`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 11:55:44 CEST (+0200)
- Release-classification heads verified before write-up:
  - `origin/lane/reliable-executor` -> `9fed3c4937c85da6c2bdca69d1a0341d837bdf52` (`Map safe comment graph edges and live proof`)
  - `origin/lane/critic` -> `c9f11abfc26364b15bb8b0299b300020ce251a3e`
  - `origin/lane/independent-auditor` -> `a943d976c9891884ffa928c952864989d895dacc`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Safe comment graph edges on the checked planner path | `9fed3c49` extends the WordPress graph planner to treat `wp_comments` and `wp_commentmeta` like other same-plan graph surfaces, adds safe relationships for `comment-post`, `comment-parent`, and `commentmeta-comment`, and proves a same-plan comment/commentmeta closure in `test/push-planner.test.js`. | No production-owned release boundary was added. This is graph-planner support for comments, not proof of live auth/session issuance, durable journal ownership, or real-endpoint mutation safety. | Support-only |
| Unsafe comment graph references | The new test blocks comment references when the remote post target is missing, which confirms the planner still stops on a live graph inconsistency. | That does not prove a production push path. There is still no checked real-endpoint command proving issuance, readback, expiry, rotation, revocation, cleanup, and replay rejection on the same executable release path. | Blocked |
| Durable restart-readable journal ownership | The commit does not add durable-journal ownership, lease fencing, restart-readable replay, or production storage consumption. | One checked real-endpoint command that proves the release path consumes durable journal ownership with restart-readable artifacts and lease-fenced state. | Blocked |
| Live mutation boundary | The change stays inside the checked planner and the protocol fixture. It does not exercise a production-owned mutation path on the real Reprint endpoint. | One production-owned, non-lab-backed checked mutation boundary on the real source URL. | Blocked |
| Auth/session lifecycle | The protocol fixture drops the graph-postmeta filter from the live proof, but that only widens the lab-backed protocol slice. It still does not prove the full production lifecycle or a live source boundary. | Production-backed auth/session issuance/readback/expiry/rotation/revocation/cleanup on the checked release path. | Blocked |
| Release-boundary proof | The checked path now includes more same-plan graph coverage and a live protocol proof path, but it still does not prove the same executable real-endpoint path owns the live source, preserved remote evidence, and pre-mutation revalidation. | One production-owned checked release artifact on the real Reprint endpoint tying together auth issuance/readback, durable journal ownership, rejected-remote preservation, and apply-time revalidation. | Blocked |

## Change Assessment

1. `9fed3c49` is useful support because it extends the checked planner to more WordPress graph surfaces, especially comments and commentmeta.
2. It also widens the live protocol proof by keeping the `local-edited` snapshot intact instead of deleting the unmapped graph postmeta fixture from the lab proof path.
3. Those are still support changes. They do not exercise a real Reprint source boundary, so they cannot prove live auth/session issuance, durable journal ownership on the real endpoint, or apply-time revalidation on the production boundary.
4. The tests now validate same-plan comment graph closure and a missing-target block, but they do not prove a production-owned real-endpoint artifact. The release verdict therefore stays at `0/4`.

## Conclusion

`9fed3c4937c85da6c2bdca69d1a0341d837bdf52` closes no supervised release gate. It is a checked support expansion for WordPress graph identity handling and a lab-proof cleanup, but it still leaves the missing production-owned real-endpoint proof unchanged. The verdict remains `0/4`.

The next exact production primitive is still one checked live release command on the real Reprint endpoint that shows:

- the exact live `REPRINT_PUSH_SOURCE_URL`
- the same executable auth-session source command at issuance and readback
- durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership
- preserved rejected remote evidence for audit
- apply-time revalidation before the first mutation on that same live boundary

Until that exists, the release-gate verdict stays at `0/4`.
