# Objective Audit

## Verdict

- Audited commit: `401ee0b3ac3d17ef3599627e99ca4db906df8a83` (`Surface recovery journal claim identities`)
- Previous audited reliable head: `97790e454633adf887e04db408d8fa0fd59d4346`
- Latest reliable diff reviewed: `97790e454633adf887e04db408d8fa0fd59d4346..401ee0b3ac3d17ef3599627e99ca4db906df8a83`
- Reliable advanced since the supervisor baseline: `no`
- Current critic head: `02890172771c3effe2c44494eeef00c12f719b8e`
- Critic verdict: `0/4`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 07:40:42 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `401ee0b3ac3d17ef3599627e99ca4db906df8a83` (`Surface recovery journal claim identities`)
  - `origin/lane/critic` -> `02890172771c3effe2c44494eeef00c12f719b8e` (`Classify reliable head 401ee0b3`)
  - `origin/lane/independent-auditor` -> `59ae6088774b2246a542c3d6a4b751d4e2856b59`
  - `origin/main` -> `1c7ccf9e8d5f6b6974f6ee4ceb92840d34391565`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Recovery-journal claim identity surfacing | `src/recovery-journal.js` now carries `claimId` and `previousClaimId` through `recovery-claim-opened`, `stale-claim-rejected`, and `stale-claim-advanced` records, and `openProductionRecoveryJournal().inspect()` now emits a `claim` summary plus `writerLease`, `leaseFence`, `storageGuard`, and `ownership` metadata keyed to that claim identity. | A production-owned real Reprint endpoint that proves those surfaced identities are emitted and enforced by the actual live mutation boundary, not only by the file-backed recovery-journal adapter. | Support-only |
| Checked-proof visibility | `test/recovery-journal.test.js` and `test/production-shaped-proof.test.js` now assert that the checked release path exposes stale-claim rejection, active claim IDs, claim key hashes, and single-writer lease metadata in the proof payload. | One checked live run on the real endpoint that shows the same fields during a production auth/session lifecycle and live apply boundary, with restart-readability and stale-claim fencing on that same boundary. | Support-only |
| File-backed adapter semantics | The new inspection payload still reports `productionAdapter: 'openProductionRecoveryJournal'` and `storageGuard: 'filesystem-compare-rename'`, which documents the local file-backed journal surface more explicitly. | File-backed adapter metadata is still not proof of the production `wpdb-single-statement-cas` journal boundary or a live Reprint endpoint that owns the journal across crash, replay, and retry. | Support-only |
| Production-owned auth/session lifecycle | No part of `401ee0b3` adds a production auth/session issuer, scoped production credential store, or live session readback from a real Reprint endpoint. | One checked live run on the real endpoint proving auth/session issuance, readback, rotation or expiry handling, and rejection of stale or lab-backed credentials on the same boundary. | Blocked |
| Durable journal ownership with lease fencing and restart-readable replay | `401ee0b3` surfaces more claim metadata, but it does not add new production-owned journal behavior, live lease enforcement, or restart-readable replay on a real endpoint. | Real endpoint proof that the durable journal is production-owned, lease-fenced, crash-readable after restart, and tied to the same live boundary being audited. | Blocked |
| Plugin-driver ownership | No plugin-driver or plugin-owned resource semantics change appears in `401ee0b3`. | Real boundary proof for plugin-driver ownership and conservative blocking or validation of plugin-owned state on the release path. | Blocked |
| Preserved rejected-remote evidence and first-mutation revalidation | The surfaced stale-claim identity fields make rejection evidence more inspectable, but there is still no production-owned proof that rejected remote evidence is durably preserved or that the same boundary revalidates immediately before first mutation. | One checked live run on the real endpoint proving preserved rejected-remote evidence plus apply-time revalidation before first mutation on that same production boundary. | Blocked |

## Release Blockers

1. `401ee0b3` usefully surfaces recovery-journal claim identities and single-writer lease details in checked proof output, but it does not add production-owned endpoint behavior.
2. The core evidence remains `src/recovery-journal.js`, `test/recovery-journal.test.js`, and `test/production-shaped-proof.test.js`, so this is still proof surfacing plus regression coverage around the file-backed adapter and checked verifier path.
3. There is still no checked live run proving auth/session issuance and later readback on the same production-owned boundary.
4. There is still no checked live run proving durable restart-readable journal ownership with lease fencing, plugin-driver ownership, preserved rejected-remote evidence, and apply-time revalidation before the first mutation on that same production-owned boundary.

## Critic Alignment

The current critic verdict at `02890172771c3effe2c44494eeef00c12f719b8e` remains aligned with this audit. Both lanes treat `401ee0b3` as useful checked-proof surfacing for recovery-journal claim identities while keeping the overall release-gate verdict at `0/4`.

## Next Primitive

The next exact production primitive remains one checked live release command on the real Reprint endpoint that proves all of the following together on the same boundary:

1. live auth/session issuance and readback
2. durable restart-readable journal ownership with lease fencing
3. plugin-driver ownership on the release boundary
4. preserved rejected-remote evidence
5. apply-time revalidation before the first mutation

Until that exists, the release-gate verdict stays `0/4`.
