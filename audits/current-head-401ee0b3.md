Audited `401ee0b3ac3d17ef3599627e99ca4db906df8a83` (`Surface recovery journal claim identities`).

Verdict: `0/4`

What changed:
- `src/recovery-journal.js` now persists and surfaces `claimId` and `previousClaimId` on claim-opened, stale-claim-rejected, and stale-claim-advanced records instead of only hashed identities.
- `openProductionRecoveryJournal().inspect()` now emits richer checked proof with `claim`, `ownership`, `storageGuard`, `writerLease`, and nested `leaseFence.writerLease` metadata, making stale-claim rejection and active-claim identity auditable in the journal inspection payload.
- `test/recovery-journal.test.js` adds regression coverage for those surfaced fields on the file-backed production recovery journal adapter.
- `test/production-shaped-proof.test.js` verifies that the checked release proof now prints the surfaced claim identity and single-writer lease data.

Why it does not move the gate:
- This is proof surfacing in the recovery-journal adapter and checked verifier path, not new production-owned endpoint behavior. The diff does not add a real Reprint endpoint, a production auth/session issuer, or a live release command run against a real boundary.
- The new adapter proof still declares `productionAdapter: 'openProductionRecoveryJournal'` with `storageGuard: 'filesystem-compare-rename'`. That documents the local file-backed journal path more clearly, but it is not proof that the production `wpdb-single-statement-cas` journal boundary is owned and enforced by the real endpoint.
- The tests prove visibility of claim identity metadata and stale-claim fencing evidence, not the missing release-gate primitives: production-owned auth/session lifecycle, durable restart-readable journal ownership with live lease fencing on the real endpoint, plugin-driver ownership, preserved rejected-remote evidence, and apply-time revalidation before first mutation on that same boundary.

Evidence reviewed:
- `401ee0b3ac3d17ef3599627e99ca4db906df8a83:src/recovery-journal.js`
- `401ee0b3ac3d17ef3599627e99ca4db906df8a83:test/recovery-journal.test.js`
- `401ee0b3ac3d17ef3599627e99ca4db906df8a83:test/production-shaped-proof.test.js`
- `02890172771c3effe2c44494eeef00c12f719b8e` (`Classify reliable head 401ee0b3`)

Critic alignment:
- `origin/lane/critic` at `02890172771c3effe2c44494eeef00c12f719b8e` also keeps the verdict at `0/4`, and this audit agrees.

Next blocker:
- One checked live release run on the real Reprint endpoint must still prove live auth/session issuance/readback, durable restart-readable journal ownership with lease fencing, plugin-driver ownership on the release boundary, preserved rejected-remote evidence, and apply-time revalidation before the first mutation.
