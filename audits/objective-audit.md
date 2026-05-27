# Objective Audit

## Verdict

- Audited commit: `349826d919f747c8a3d207a8f39faf9c67e9fa92` (`Fail closed on stale auth session summaries`)
- Previous audited reliable head: `4c4e769f903e6b00cbf6a0ddf50a0a993302d741`
- Latest reliable diff reviewed: `4c4e769f903e6b00cbf6a0ddf50a0a993302d741..349826d919f747c8a3d207a8f39faf9c67e9fa92`
- Reliable advanced since the supervisor baseline: `no`
- Current critic head: `26bee883c453967daa79767603a9b1697c4d060a`
- Critic verdict: `0/4`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 06:59:24 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `349826d919f747c8a3d207a8f39faf9c67e9fa92` (`Fail closed on stale auth session summaries`)
  - `origin/lane/critic` -> `26bee883c453967daa79767603a9b1697c4d060a` (`Classify reliable head 349826d9`)
  - `origin/lane/independent-auditor` -> `315376ddf584975b3cb4cad26d114839ac5dcf84` (`Audit reliable head e9c9e369`)
  - `origin/lane/progress-publisher` -> `55003d435bb6982cdbfa8887c9ed54a521fc443e` (`Refresh public progress for e9c9e369`)
  - `origin/main` -> `65ba906400b7ecc7028bbb8f77297ca6b3341898` (`Refresh live progress page`)

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Stale lifecycle summary refusal | `349826d9` adds fail-closed checks in `scripts/playground/production-auth-session-lifecycle.js` so the helper now rejects invalid top-level lifecycle flags, invalid direct summary observation fields, mismatched direct `issued` lifecycle fields against the trace, mismatched direct `read` lifecycle fields against the trace, and mismatched session ids across the summary/observations. | One production-owned real Reprint endpoint proving that the release path itself issues and reads back the auth/session lifecycle and fails closed on the same stale summary drift at the live boundary. | Support-only |
| Production-shaped stale-summary regression coverage | `test/production-shaped-proof.test.js` adds direct summary cases for stale `issued` lifecycle fields, stale `read` lifecycle fields, and a `preserved` summary that omits its phase; each now fails closed with `stale-issued-summary`, `stale-read-summary`, or `missing-phase`. | Live endpoint evidence, not production-shaped helper tests, showing the real boundary rejects stale auth/session lifecycle summaries before any production mutation counts. | Support-only |
| Live auth/session issuance and readback | The new commit still validates summary shape in production-shaped/lab-scoped evidence. It does not mint or read back a live auth/session from a production-owned Reprint endpoint. | A checked real-endpoint run proving live auth/session issuance, preserved readback, and lifecycle ownership on that same boundary. | Blocked |
| Durable restart-readable journal ownership | The helper now cross-checks direct summary snapshots against the observation trace, but the evidence still stops at lab-scoped production-shaped lifecycle summaries. | Durable restart-readable journal ownership with lease fencing on the production-owned boundary. | Blocked |
| Preserved rejected-remote evidence | The new tests only harden stale summary drift detection. They do not show rejected-remote evidence being preserved on the real endpoint. | Real boundary evidence that rejected remote state is preserved and auditable end to end. | Blocked |
| Apply-time revalidation before first mutation | The new summary checks can refuse stale production-shaped lifecycle evidence, but they do not prove the real endpoint revalidates live state before the first production mutation on that same boundary. | Real-endpoint apply-time revalidation before first mutation on the same production-owned boundary. | Blocked |
| Evidence quality | `349826d9` is fail-closed summary-shape hardening in a production-shaped helper plus lab-scoped proof tests. It narrows false-positive lifecycle summaries, but it does not move execution ownership to the production endpoint. | Production ownership of auth/session lifecycle, journal storage, rejected-remote evidence, and first-mutation revalidation in one checked release command. | Support-only |

## Release Blockers

1. `349826d9` is useful fail-closed stale-summary hardening, but it is still helper/test-side proof-shape hardening.
2. The checked path remains production-shaped/lab-scoped scaffolding rather than a proven production-owned Reprint endpoint boundary.
3. There is still no checked live run proving auth/session issuance and later readback on that same boundary.
4. There is still no checked live run proving durable restart-readable journal ownership with lease fencing on that same boundary.
5. There is still no checked live run proving preserved rejected-remote evidence plus apply-time revalidation before the first mutation on that same boundary.

## Critic Alignment

The current critic verdict at `26bee883c453967daa79767603a9b1697c4d060a` remains aligned with this audit. `349826d9` improves fail-closed stale auth/session lifecycle summary accounting, but it still does not move the release gates because the proof stops at production-shaped verifier/helper scaffolding instead of a production-owned endpoint.

## Next Primitive

The next exact production primitive remains one checked live release command on the real Reprint endpoint that proves all of the following together on the same boundary:

1. live auth/session issuance and readback
2. durable restart-readable journal ownership with lease fencing
3. preserved rejected-remote evidence
4. apply-time revalidation before the first mutation

Until that exists, the release-gate verdict stays `0/4`.
