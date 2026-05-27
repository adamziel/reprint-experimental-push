# Objective Audit

## Verdict

- Audited commit: `bc4679930d9d27adfb84b49b075816ff2e4d9ead` (`Tighten replay auth session equivalence`)
- Previous audited reliable head: `6734e8368c0299e665957757207e883c35186227`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 06:32:11 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `bc4679930d9d27adfb84b49b075816ff2e4d9ead` (`Tighten replay auth session equivalence`)
  - `origin/lane/critic` -> `6b335bbfe284f136c7a7884abd71561500a0dc07`
  - `origin/lane/independent-auditor` -> `29528824670b4a06b1dc89ca96aad34300632589`
  - `origin/lane/progress-publisher` -> `7072aa89f060e5f6846572f8bfb479d4099c3e1b`
  - `origin/main` -> `c6428df6bf58f67ab3be0e51e6bdcd6734912679`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Replay auth-session equivalence | `bc467993` makes replay equivalence compare revoked, cleaned-up, rotated, preserved, and expired auth-session lifecycle bits, and adds a fail-closed proof for `authSessionPreserved` drift. | A production-owned real endpoint proving replay preserves auth/session lifecycle state across the actual release boundary. | Blocked |
| Checked durable-journal proof requirement | `6734e836` still preserves the prior hardening: the checked release path requires `checkedDurableJournalBoundarySatisfied()` when production auth/session checking is enabled, so weak `/db-journal` evidence no longer satisfies the path. | A production-owned real endpoint proving the same checked durable-journal boundary outside Playground/package scaffolding. | Blocked |
| Checked release auth/session read | `ef5e52ce` still preserves the prior hardening: auth/session lifecycle summaries prefer `journal` or `replay` reads over later recovery-inspect observations. | A production-owned real endpoint proving the same release-boundary auth/session read outside Playground/package scaffolding. | Blocked |
| Durable restart-readable journal ownership | The prior coherent claim-identity evidence remains, and the checked path still rejects weak journal summaries. This head does not move durable journal ownership onto a real endpoint. | Durable journal ownership with lease-fenced restart-readable behavior outside Playground/package-only scaffolding. | Blocked |
| Production auth/session lifecycle | The commit tightens replay lifecycle equivalence, but it does not create production auth/session issuance/readback on a real source boundary. | A checked real-endpoint command proving the same executable path mints and later reads back a live auth session on the actual production source boundary. | Blocked |
| Apply-time revalidation before first mutation | The explicit live proof still asserts apply revalidation, but this commit does not move that proof onto a production-owned source endpoint. | A checked real-endpoint proof showing that same apply-time revalidation happens before the first mutation on the production-owned boundary. | Blocked |
| Evidence quality | The diff adds a focused fail-closed replay mismatch test and exposes lifecycle mismatch fields in the production-shaped harness. | Production ownership of the source route, auth session, durable journal, and replay evidence remains unproven. | Support-only |

## Release Blockers

1. `bc467993` is material auth/session replay hardening because replay equivalence now fails closed on lifecycle state drift such as `authSessionPreserved`.
2. The proof still depends on production-shaped helper surfaces rather than one production-owned source boundary on the real Reprint endpoint.
3. There is still no checked real-endpoint command proving production-owned auth/session issuance and readback on the actual source boundary.
4. The durable-journal path still lacks live production-owned restart-readable storage and lease-fenced replay evidence on the release boundary.

## Next Primitive

The next exact production primitive remains one checked live release command on the real Reprint endpoint that shows the exact live `REPRINT_PUSH_SOURCE_URL`, the same auth-session source command at issuance and readback, durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership, preserved rejected-remote evidence, and apply-time revalidation before the first mutation.

The next focused regression test should fail unless one real-endpoint proof artifact contains all of those fields together.
