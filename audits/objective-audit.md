# Objective Audit

## Verdict

- Audited commit: `3e9eef4166dc2c5a603b48e269af3f16320c85ee` (`Preserve source-owned recovery journal proof`)
- Previous audited reliable head: `478407dde9e178c1967b4e0873c63ad5e30e23e2`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 06:12:55 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `3e9eef4166dc2c5a603b48e269af3f16320c85ee` (`Preserve source-owned recovery journal proof`)
  - `origin/lane/critic` -> `49ca458b9ccdc540975caba45c0e245b4b647fd6`
  - `origin/lane/independent-auditor` -> `8647ca0b407714265426f6cade58594b197bdb54`
  - `origin/lane/progress-publisher` -> `aeb3ec2ebfe7b5e422eb765e8d43ececd5b6d1bf`
  - `origin/main` -> `4e519b3ebc13fb7c5969ffac9eaa3c57754ef3bf`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Source-owned recovery journal proof | `3e9eef41` makes the release verifier prefer accepted recovery-inspect journal evidence before `/db-journal` evidence, preserves recovery journal claim and storage-guard fields in the authenticated client, and asserts `wpdb-single-statement-cas` storage guard evidence on packaged and explicit checked-live proof paths. | A production-owned real endpoint proving that same source-owned recovery journal outside Playground/package scaffolding. | Blocked |
| Durable restart-readable journal ownership | The change narrows checked-journal evidence by keeping source-owned recovery claim and storage-guard details on the summarized proof surface. | Durable journal ownership with lease-fenced restart-readable behavior outside Playground/package-only scaffolding. | Blocked |
| Production auth/session lifecycle | The commit does not change the production auth/session issuance/readback boundary. | A checked real-endpoint command proving the same executable path mints and later reads back a live auth session on the actual production source boundary. | Blocked |
| Apply-time revalidation before first mutation | The explicit live proof still asserts apply revalidation, but this commit does not move that proof onto a production-owned source endpoint. | A checked real-endpoint proof showing that same apply-time revalidation happens before the first mutation on the production-owned boundary. | Blocked |
| Evidence quality | The diff makes the checked release proof prefer source-owned recovery journal evidence and keeps its claim/storage fields visible to audits. | Production ownership of the source route, auth session, durable journal, and replay evidence remains unproven. | Support-only |

## Release Blockers

1. `3e9eef41` is material durable-journal evidence hardening because accepted recovery-inspect journal evidence now wins over `/db-journal` fallback evidence and carries claim/storage details through the checked proof.
2. The proof still depends on production-shaped helper surfaces rather than one production-owned source boundary on the real Reprint endpoint.
3. There is still no checked real-endpoint command proving production-owned auth/session issuance and readback on the actual source boundary.
4. The durable-journal path still lacks live production-owned restart-readable storage and lease-fenced replay evidence on the release boundary.

## Next Primitive

The next exact production primitive remains one checked live release command on the real Reprint endpoint that shows the exact live `REPRINT_PUSH_SOURCE_URL`, the same auth-session source command at issuance and readback, durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership, preserved rejected-remote evidence, and apply-time revalidation before the first mutation.

The next focused regression test should fail unless one real-endpoint proof artifact contains all of those fields together.
