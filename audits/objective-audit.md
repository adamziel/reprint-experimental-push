# Objective Audit

## Verdict

- Audited commit: `c40affc90c17853bc61a213e6e32fa6ffdfb510c` (`Require journal auth continuity`)
- Previous audited reliable head: `c208a12d28b3abcef15920c27eef424d68cad996`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 12:14:07 CEST (+0200)
- Release-classification heads verified before write-up:
  - `origin/lane/reliable-executor` -> `c40affc90c17853bc61a213e6e32fa6ffdfb510c` (`Require journal auth continuity`)
  - `origin/lane/critic` -> `854bb85c9de340a7fc8ec39644535474182f4c9d`
  - `origin/lane/independent-auditor` -> `a21f1f38a5477b497e02079c16ef7bad20d6aff4`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Journal auth continuity | `c40affc9` makes the checked client fail closed when db-journal readback drops the auth envelope, even when the preflight session is production-shaped. | A production-owned live endpoint that proves auth/session issuance and readback on the real `REPRINT_PUSH_SOURCE_URL` boundary. | Support-only |
| Production auth/session lifecycle | The new tests confirm the client rejects missing journal auth continuity and preserve the current `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED`/`AUTH_SESSION_LIFECYCLE_DRIFT` split. | One checked live `verify:release` command that proves issuance, read, expiry, rotation, revocation, cleanup, and replay rejection on a real production boundary. | Blocked |
| Durable journal ownership | The diff still exercises journal readback through mocks and summary assertions; it does not establish live restart-readable production storage or lease/fencing ownership. | Durable restart-readable journal ownership with lease/fencing, demonstrated by the release path that owns the real endpoint. | Blocked |
| Production boundary ownership | The commit remains inside client/test hardening and does not demonstrate a real production-owned `/wp-json/reprint/v1/push/*` boundary. | A checked command that mutates the real endpoint and proves the same boundary is owned by production, not the harness. | Blocked |
| Preserved rejected remote evidence and revalidation | The release path still does not prove preserved rejected remote evidence or apply-time revalidation before first mutation on the live boundary. | Preserved rejected remote evidence and apply-time revalidation before first mutation on the production-owned release path. | Blocked |
| Plugin-driver release ownership | No part of the change establishes plugin-driver ownership on the release boundary; the evidence remains confined to journal auth continuity hardening. | Evidence that the plugin-driven release path owns the real boundary instead of a support harness or lab wrapper. | Blocked |

## Change Assessment

1. `c40affc9` is journal auth continuity hardening in the checked client and its tests, not release-boundary proof.
2. Its concrete effect is to fail closed when journal readback loses the auth envelope for a production-shaped session, even outside the stricter production-session gate.
3. That is useful, but it still does not prove a production-owned, non-lab `REPRINT_PUSH_SOURCE_URL` endpoint boundary.
4. No release gate moved. The project remains `0/4`.

## Conclusion

`c40affc90c17853bc61a213e6e32fa6ffdfb510c` is journal auth continuity hardening for the checked client. It improves fail-closed coverage when the journal readback drops auth-envelope continuity, but it still does not prove the production-owned, non-lab `REPRINT_PUSH_SOURCE_URL` endpoint boundary, so it does not close any release gate.
