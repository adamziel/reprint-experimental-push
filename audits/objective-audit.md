# Objective Audit

## Verdict

- Audited commit: `4a8447f5074873b27d90c91b35ea0bc11f62c911` (`Preserve explicit auth session expiry markers`)
- Previous audited reliable head: `5be6341164ce667bd026b2e4ae92bc10f688b431`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 06:45:37 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `4a8447f5074873b27d90c91b35ea0bc11f62c911` (`Preserve explicit auth session expiry markers`)
  - `origin/lane/critic` -> `9093d1da917c335b121fcc5fe13605a4e1049cf6`
  - `origin/lane/independent-auditor` -> `21452583f2632d5321b2e39fd7cf809cb27b48de`
  - `origin/lane/progress-publisher` -> `facd9c627ef8cbbc04aa96dd5e3208230649ace1`
  - `origin/main` -> `10af6be1c44773652e774b5812f9139a68bef51a`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Explicit auth/session expiry markers | `4a8447f5` preserves explicit expired markers and field evidence in auth/session lifecycle summaries, with coverage that distinguishes expired and rotated observations from preserved reads. | A production-owned real endpoint proving the same lifecycle evidence on the actual checked release path. | Blocked |
| Release-boundary auth/session lifecycle accounting | `5be63411` still preserves the prior hardening: lifecycle summary failure checks are limited to observations up to the selected release-boundary read. | A production-owned real endpoint proving that boundary on the actual release path, not only the production-shaped proof surface. | Blocked |
| Checked journal claim-key coherence | `c2288a42` still preserves the prior hardening: writer leases and nested lease-fence writer leases must carry the same claim key hash as the active journal claim. | A production-owned real endpoint proving the same claim-key coherence in durable journal ownership outside Playground/package scaffolding. | Blocked |
| Replay auth-session equivalence | `bc467993` still preserves the prior hardening: replay equivalence compares revoked, cleaned-up, rotated, preserved, and expired auth-session lifecycle bits, and fails closed on `authSessionPreserved` drift. | A production-owned real endpoint proving replay preserves auth/session lifecycle state across the actual release boundary. | Blocked |
| Checked durable-journal proof requirement | `6734e836` still preserves the prior hardening: the checked release path requires `checkedDurableJournalBoundarySatisfied()` when production auth/session checking is enabled, so weak `/db-journal` evidence no longer satisfies the path. | A production-owned real endpoint proving the same checked durable-journal boundary outside Playground/package scaffolding. | Blocked |
| Checked release auth/session read | `ef5e52ce` still preserves the prior hardening: auth/session lifecycle summaries prefer `journal` or `replay` reads over later recovery-inspect observations. | A production-owned real endpoint proving the same release-boundary auth/session read outside Playground/package scaffolding. | Blocked |
| Durable restart-readable journal ownership | The prior checked journal contract now includes claim-key coherence, but this head does not move durable journal ownership onto a real endpoint. | Durable journal ownership with lease-fenced restart-readable behavior outside Playground/package-only scaffolding. | Blocked |
| Production auth/session lifecycle | The commit improves lifecycle proof shape, but it does not create production auth/session issuance/readback on a real source boundary. | A checked real-endpoint command proving the same executable path mints and later reads back a live auth session on the actual production source boundary. | Blocked |
| Apply-time revalidation before first mutation | The explicit live proof still asserts apply revalidation, but this commit does not move that proof onto a production-owned source endpoint. | A checked real-endpoint proof showing that same apply-time revalidation happens before the first mutation on the production-owned boundary. | Blocked |
| Evidence quality | The diff adds coverage for explicit expired boolean markers and status-only rotated markers in production-shaped auth/session lifecycle summaries. | Production ownership of the source route, auth session, durable journal, and replay evidence remains unproven. | Support-only |

## Release Blockers

1. `4a8447f5` is material proof-shape hardening because explicit expired markers survive lifecycle summarization and are distinguished from preserved release-boundary reads.
2. The proof still depends on production-shaped helper surfaces rather than one production-owned source boundary on the real Reprint endpoint.
3. There is still no checked real-endpoint command proving production-owned auth/session issuance and readback on the actual source boundary.
4. The durable-journal path still lacks live production-owned restart-readable storage and lease-fenced replay evidence on the release boundary.

## Next Primitive

The next exact production primitive remains one checked live release command on the real Reprint endpoint that shows the exact live `REPRINT_PUSH_SOURCE_URL`, the same auth-session source command at issuance and readback, durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership, preserved rejected-remote evidence, and apply-time revalidation before the first mutation.

The next focused regression test should fail unless one real-endpoint proof artifact contains all of those fields together.
