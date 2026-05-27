# Objective Audit

## Verdict

- Audited commit: `5be6341164ce667bd026b2e4ae92bc10f688b431` (`Ignore post-boundary auth session cleanup drift`)
- Previous audited reliable head: `c2288a428207d9b5daa0aa771976fb16784346a9`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 06:39:01 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `5be6341164ce667bd026b2e4ae92bc10f688b431` (`Ignore post-boundary auth session cleanup drift`)
  - `origin/lane/critic` -> `d1353aef41f001e31b02e7d303350fc43533e660`
  - `origin/lane/independent-auditor` -> `7feecfb360d2ca033624f89e9a8d2d125d5305ef`
  - `origin/lane/progress-publisher` -> `629aa8e6832c3b2d29e282f9f46678420b2912f2`
  - `origin/main` -> `aac00e1c7ba133b5d29e373122a5bf734af02b33`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Release-boundary auth/session lifecycle accounting | `5be63411` limits lifecycle summary failure checks to observations up to the selected release-boundary read, so cleanup, revocation, rotation, or expiry after the boundary cannot invalidate a preserved checked read. | A production-owned real endpoint proving that boundary on the actual release path, not only the production-shaped proof surface. | Blocked |
| Checked journal claim-key coherence | `c2288a42` still preserves the prior hardening: writer leases and nested lease-fence writer leases must carry the same claim key hash as the active journal claim. | A production-owned real endpoint proving the same claim-key coherence in durable journal ownership outside Playground/package scaffolding. | Blocked |
| Replay auth-session equivalence | `bc467993` still preserves the prior hardening: replay equivalence compares revoked, cleaned-up, rotated, preserved, and expired auth-session lifecycle bits, and fails closed on `authSessionPreserved` drift. | A production-owned real endpoint proving replay preserves auth/session lifecycle state across the actual release boundary. | Blocked |
| Checked durable-journal proof requirement | `6734e836` still preserves the prior hardening: the checked release path requires `checkedDurableJournalBoundarySatisfied()` when production auth/session checking is enabled, so weak `/db-journal` evidence no longer satisfies the path. | A production-owned real endpoint proving the same checked durable-journal boundary outside Playground/package scaffolding. | Blocked |
| Checked release auth/session read | `ef5e52ce` still preserves the prior hardening: auth/session lifecycle summaries prefer `journal` or `replay` reads over later recovery-inspect observations. | A production-owned real endpoint proving the same release-boundary auth/session read outside Playground/package scaffolding. | Blocked |
| Durable restart-readable journal ownership | The prior checked journal contract now includes claim-key coherence, but this head does not move durable journal ownership onto a real endpoint. | Durable journal ownership with lease-fenced restart-readable behavior outside Playground/package-only scaffolding. | Blocked |
| Production auth/session lifecycle | The commit tightens which trace segment counts for checked lifecycle evidence, but it does not create production auth/session issuance/readback on a real source boundary. | A checked real-endpoint command proving the same executable path mints and later reads back a live auth session on the actual production source boundary. | Blocked |
| Apply-time revalidation before first mutation | The explicit live proof still asserts apply revalidation, but this commit does not move that proof onto a production-owned source endpoint. | A checked real-endpoint proof showing that same apply-time revalidation happens before the first mutation on the production-owned boundary. | Blocked |
| Evidence quality | The diff adds proof coverage for post-boundary lifecycle cleanup/expiry/revocation/rotation not poisoning a valid boundary read. | Production ownership of the source route, auth session, durable journal, and replay evidence remains unproven. | Support-only |

## Release Blockers

1. `5be63411` is material release-boundary lifecycle hardening because only the trace segment through the selected checked read can invalidate auth/session lifecycle proof.
2. The proof still depends on production-shaped helper surfaces rather than one production-owned source boundary on the real Reprint endpoint.
3. There is still no checked real-endpoint command proving production-owned auth/session issuance and readback on the actual source boundary.
4. The durable-journal path still lacks live production-owned restart-readable storage and lease-fenced replay evidence on the release boundary.

## Next Primitive

The next exact production primitive remains one checked live release command on the real Reprint endpoint that shows the exact live `REPRINT_PUSH_SOURCE_URL`, the same auth-session source command at issuance and readback, durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership, preserved rejected-remote evidence, and apply-time revalidation before the first mutation.

The next focused regression test should fail unless one real-endpoint proof artifact contains all of those fields together.
