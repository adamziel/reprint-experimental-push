# Objective Audit

## Verdict

- Audited commit: `ef5e52cec9072c278f751ff2fe0be78659912987` (`Prefer checked release auth session reads`)
- Previous audited reliable head: `aaa7e219c104fe4ef99c485ddeaad4271bd8c535`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 06:20:22 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `ef5e52cec9072c278f751ff2fe0be78659912987` (`Prefer checked release auth session reads`)
  - `origin/lane/critic` -> `ed61b0d1a2fe37dbd32da8bacd07100f8fc63617`
  - `origin/lane/independent-auditor` -> `6c6a7941469bcb2e4366ef5d00a16aee96c4e8a1`
  - `origin/lane/progress-publisher` -> `e7c8ab5b3a264da376693ecf94417e0e8fdac0e5`
  - `origin/main` -> `4e519b3ebc13fb7c5969ffac9eaa3c57754ef3bf`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Checked release auth/session read | `ef5e52ce` makes auth/session lifecycle summaries prefer `journal` or `replay` reads over later recovery-inspect observations, with a focused proof test so recovery inspection cannot accidentally satisfy the checked release read boundary. | A production-owned real endpoint proving the same release-boundary auth/session read outside Playground/package scaffolding. | Blocked |
| Durable restart-readable journal ownership | The prior coherent claim-identity evidence remains, but this head does not move the durable journal proof onto a real endpoint. | Durable journal ownership with lease-fenced restart-readable behavior outside Playground/package-only scaffolding. | Blocked |
| Production auth/session lifecycle | The commit tightens which read counts for checked lifecycle evidence, but it does not create production auth/session issuance/readback on a real source boundary. | A checked real-endpoint command proving the same executable path mints and later reads back a live auth session on the actual production source boundary. | Blocked |
| Apply-time revalidation before first mutation | The explicit live proof still asserts apply revalidation, but this commit does not move that proof onto a production-owned source endpoint. | A checked real-endpoint proof showing that same apply-time revalidation happens before the first mutation on the production-owned boundary. | Blocked |
| Evidence quality | The diff prevents later recovery-inspect observations from masking the release-boundary read that should come from `journal` or `replay`. | Production ownership of the source route, auth session, durable journal, and replay evidence remains unproven. | Support-only |

## Release Blockers

1. `ef5e52ce` is material auth/session evidence hardening because checked lifecycle summaries now prefer release-boundary reads from `journal` or `replay`.
2. The proof still depends on production-shaped helper surfaces rather than one production-owned source boundary on the real Reprint endpoint.
3. There is still no checked real-endpoint command proving production-owned auth/session issuance and readback on the actual source boundary.
4. The durable-journal path still lacks live production-owned restart-readable storage and lease-fenced replay evidence on the release boundary.

## Next Primitive

The next exact production primitive remains one checked live release command on the real Reprint endpoint that shows the exact live `REPRINT_PUSH_SOURCE_URL`, the same auth-session source command at issuance and readback, durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership, preserved rejected-remote evidence, and apply-time revalidation before the first mutation.

The next focused regression test should fail unless one real-endpoint proof artifact contains all of those fields together.
