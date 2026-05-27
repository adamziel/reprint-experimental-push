# Objective Audit

## Verdict

- Audited commit: `e9c9e36980b738f584eadf113ff5599ce885cd39` (`Fail closed on stale-claim lifecycle drift`)
- Previous audited reliable head: `4a8447f5074873b27d90c91b35ea0bc11f62c911`
- Latest reliable diff reviewed: `4a8447f5074873b27d90c91b35ea0bc11f62c911..e9c9e36980b738f584eadf113ff5599ce885cd39`
- Current critic head: `b65ef92b468745ef9baba7c12b5bc65938b2a977`
- Critic verdict: `0/4`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 06:51:25 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `e9c9e36980b738f584eadf113ff5599ce885cd39` (`Fail closed on stale-claim lifecycle drift`)
  - `origin/lane/critic` -> `b65ef92b468745ef9baba7c12b5bc65938b2a977` (`Classify reliable head e9c9e369`)
  - `origin/lane/independent-auditor` -> `2a5dc60ad1f22c07572674c70ad92b73db0d8beb` (`Audit reliable head 4a8447f5`)
  - `origin/lane/progress-publisher` -> `facd9c627ef8cbbc04aa96dd5e3208230649ace1` (`Refresh public progress for 5be63411`)
  - `origin/main` -> `10af6be1c44773652e774b5812f9139a68bef51a` (`Refresh live progress page`)

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Stale-claim lifecycle drift refusal | `e9c9e369` hardens `summarizeAuthSessionLifecycle()` and `durableJournalClaimContractMatches()` so inconsistent stale-claim status, event, and lifecycle flags fail closed instead of looking coherent (`src/authenticated-http-push-client.js`, `src/recovery-journal.js`). | One production-owned real Reprint endpoint proving the same stale-claim lifecycle on the checked release path instead of mocked production-shaped responses. | Support-only |
| Checked stale-claim regression coverage | `e9c9e369` adds a production-shaped client test that fabricates `/recovery/inspect` and `/db-journal` responses where `claim.status` and `claim.activeClaimEvent` say stale rejection but `claim.staleClaimRejected` stays `false`; the verifier still returns `DURABLE_JOURNAL_NOT_PROVEN` (`test/authenticated-http-push-client.test.js`). | Live endpoint evidence, not mocked fetch fixtures, showing the real boundary rejects the same drift before mutation. | Support-only |
| Checked journal claim contract | `e9c9e369` extends the checked journal contract so `status`, `activeClaimEvent`, and `staleClaimRejected` must agree before the durable-journal boundary can count as satisfied (`test/recovery-journal.test.js`). | Durable restart-readable journal ownership with lease fencing proven on the real endpoint boundary. | Support-only |
| Live auth/session issuance and readback | The new commit only inspects and summarizes more lifecycle metadata in production-shaped evidence. It does not mint or read back a live auth/session from a production-owned Reprint endpoint. | A checked real-endpoint run proving live auth/session issuance, preserved readback, and lifecycle ownership on that same boundary. | Blocked |
| Durable restart-readable journal ownership | The new commit strengthens internal claim-shape validation, but it still relies on packaged production-shaped/lab-scoped journal evidence. | Durable restart-readable journal ownership with lease fencing on the production-owned boundary. | Blocked |
| Preserved rejected-remote evidence | The new tests exercise replayed apply and stale-claim metadata drift, but they do not prove rejected-remote evidence preservation on the real endpoint. | Real boundary evidence that rejected remote state is preserved and auditable end to end. | Blocked |
| Apply-time revalidation before first mutation | The client still refuses inconsistent checked metadata, but this commit does not add production proof that the same boundary revalidates before the first mutation. | Real-endpoint apply-time revalidation before first mutation on the same production-owned boundary. | Blocked |
| Evidence quality | The commit is hardening of proof shape and fail-closed contracts. It is not a new production mutation slice. | Production ownership of the source route, auth/session lifecycle, journal storage, rejected-remote evidence, and first-mutation revalidation. | Support-only |

## Release Blockers

1. `e9c9e369` is good fail-closed hardening, but it is still proof-shape hardening around production-shaped mocked responses and contract checks.
2. The checked path remains production-shaped/lab-scoped scaffolding rather than a proven production-owned Reprint endpoint boundary.
3. There is still no checked live run proving auth/session issuance and later readback on that same boundary.
4. There is still no checked live run proving durable restart-readable journal ownership with lease fencing on that same boundary.
5. There is still no checked live run proving preserved rejected-remote evidence plus apply-time revalidation before the first mutation on that same boundary.

## Critic Alignment

The current critic verdict at `b65ef92b468745ef9baba7c12b5bc65938b2a977` matches this audit: `e9c9e369` improves fail-closed stale-claim lifecycle accounting, but it does not move the release gates because the proof still stops at production-shaped verifier scaffolding instead of a production-owned endpoint.

## Next Primitive

The next exact production primitive remains one checked live release command on the real Reprint endpoint that proves all of the following together on the same boundary:

1. live auth/session issuance and readback
2. durable restart-readable journal ownership with lease fencing
3. preserved rejected-remote evidence
4. apply-time revalidation before the first mutation

Until that exists, the release-gate verdict stays `0/4`.
