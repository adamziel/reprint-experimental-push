# Objective Audit

## Verdict

- Audited commit: `867a0ca0b0043918fbf9e148bd6931b3d665dcc8` (`Synthesize live auth session source command`)
- Previous audited reliable head: `534d3d2fef0cfe3f1415fd197e193b52892af8f2`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 04:57:11 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `867a0ca0b0043918fbf9e148bd6931b3d665dcc8` (`Synthesize live auth session source command`)
  - `origin/lane/critic` -> `15c25db0d7a462f6cbc5fc883cb755eb76848375`
  - `origin/lane/independent-auditor` -> `28ee96d0cbc48981cbe3c4235435810a7bd37834`
  - `origin/lane/progress-publisher` -> `7cbe475b68a4e0a0b8a1d4d817f08ddf256e6077`
  - `origin/main` -> `ef97fd8824a2bc56748fa632301acbeb4781512d`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Checked live auth-session source synthesis | `867a0ca0` now synthesizes `REPRINT_PUSH_AUTH_SESSION_SOURCE_COMMAND` from the live source URL when the caller does not pass one, and it routes the live release verify path through that helper. | A production-backed release boundary that proves the same executable path on the real endpoint mints and later reads back a live auth session, rather than just synthesizing the source command inside the wrapper. | Blocked |
| Production auth/session lifecycle | The checked wrapper still carries the live auth-session source command through the release verifier, but this commit does not prove live issuance/readback/expiry/rotation/revocation/cleanup on the actual source URL. | A checked real-endpoint command proving the same executable path mints and later reads back a live auth session on the exact production source boundary. | Blocked |
| Durable restart-readable journal ownership | The release verifier still only expresses the source-command plumbing; it does not yet consume production-owned restart-readable journal storage on the live boundary. | Durable journal proof on the real endpoint with lease-fenced ownership and restart-readable recovery outside Playground/package-only scaffolding. | Blocked |
| Apply-time revalidation before first mutation | The live wrapper still only asserts the gated proof path, not a real-endpoint mutation preceded by apply-time revalidation on the production-owned boundary. | A checked real-endpoint proof showing apply-time revalidation runs before the first mutation on the production-owned boundary. | Blocked |

## Release Blockers

1. `no-data-loss-invariants` still blocks unsupported surfaces, and there is still no production proof that the live mutation boundary is safe for arbitrary source changes.
2. `867a0ca0` improves wrapper integrity by synthesizing the live auth-session source command from the checked live URL, but it is still verifier scaffolding rather than a releasable production source-boundary primitive.
3. The checked packaged journal boundary remains supporting evidence only; the live gate decision still hinges on production ownership and auth/session depth rather than wrapper gate fidelity.
4. Public progress refreshes do not move a release gate.

## Next Primitive

The next exact production primitive remains one checked live release command on the real Reprint endpoint that shows the exact live `REPRINT_PUSH_SOURCE_URL`, the same auth-session source command at issuance and readback, durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership, preserved rejected-remote evidence, and apply-time revalidation before the first mutation.

The next focused regression test should fail unless one real-endpoint proof artifact contains all of those fields together.
