# Objective Audit

## Verdict

- Audited commit: `9784566beb683509dde38c8e4c961ea58187ce14` (`Preserve checked journal claim identities`)
- Previous audited reliable head: `349826d919f747c8a3d207a8f39faf9c67e9fa92`
- Latest reliable diff reviewed: `349826d919f747c8a3d207a8f39faf9c67e9fa92..9784566beb683509dde38c8e4c961ea58187ce14`
- Reliable advanced since the supervisor baseline: `no`
- Current critic head: `bb169bb0b75b4ebdc1ee3a284c2b6690bad4d30c`
- Critic verdict: `0/4`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 07:04:15 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `9784566beb683509dde38c8e4c961ea58187ce14` (`Preserve checked journal claim identities`)
  - `origin/lane/critic` -> `bb169bb0b75b4ebdc1ee3a284c2b6690bad4d30c` (`Update critic audit for 9784566b`)
  - `origin/lane/independent-auditor` -> `7fef165b2c88d4abbfb2fcd744a597e345373fde` (`Audit reliable head 349826d9`)
  - `origin/lane/progress-publisher` -> `55003d435bb6982cdbfa8887c9ed54a521fc443e` (`Refresh public progress for e9c9e369`)
  - `origin/main` -> `65ba906400b7ecc7028bbb8f77297ca6b3341898` (`Refresh live progress page`)

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Checked journal claim identity preservation | `9784566b` updates `scripts/playground/push-db-journal-lib.php` so `reprint_push_lab_db_journal_claim_id_from_key_hash()` derives an opaque `psh_...` claim id from the claim-key hash instead of reusing the hash as the id, and its checked claim contract no longer requires `activeClaimId === activeClaimKeyHash` or `previousClaimId === previousClaimKeyHash`. `src/recovery-journal.js` drops the same false equality assumptions from `durableJournalClaimContractMatches()`. | Proof that the production-owned Reprint endpoint itself persists and reads back distinct claim ids and claim-key hashes across the checked live boundary, rather than only validating contract shape in lab-only or production-shaped helpers. | Support-only |
| Production-shaped checked-boundary regression coverage | `test/production-shaped-proof.test.js` now asserts that checked durable-journal proof exposes token-shaped `activeClaimId` / `previousClaimId` values and 64-hex `activeClaimKeyHash` / `previousClaimKeyHash` values, and explicitly requires them to differ. `test/recovery-journal.test.js` updates the base checked-boundary contract to use distinct ids and hashes while keeping writer-lease and lease-fence joins anchored to the correct field. | Live production-endpoint evidence, not production-shaped/lab-scoped tests, proving the real checked path preserves those identities through auth/session issuance, recovery-journal persistence, and readback. | Support-only |
| Live auth/session issuance and readback | The diff strengthens checked claim identity semantics, but it does not add a production-owned real Reprint endpoint that mints and reads back a live auth/session on the same checked boundary. | A checked real-endpoint run proving live auth/session issuance, preserved readback, and lifecycle ownership on that same boundary. | Blocked |
| Durable restart-readable journal ownership with lease fencing | The checked contract is now stricter in the right way: claim ids stay opaque and claim-key hashes stay hashed while writer leases and lease fences must still line up with the active claim fields. But the concrete evidence still comes from `scripts/playground/push-db-journal-lib.php` lab fixtures and `src/recovery-journal.js` production-shaped helper inspection, not a production-owned boundary. | Durable restart-readable journal ownership with lease fencing on the production-owned endpoint boundary itself. | Blocked |
| Preserved rejected-remote evidence | No part of `9784566b` extends the proof that rejected remote state is durably preserved and auditable on the real endpoint. | Real boundary evidence that rejected remote state is preserved and auditable end to end. | Blocked |
| Apply-time revalidation before first mutation | No part of `9784566b` proves the production-owned endpoint revalidates live state before the first mutation; the added coverage only hardens checked identity semantics within support scaffolding. | Real-endpoint apply-time revalidation before first mutation on the same production-owned boundary. | Blocked |
| Evidence quality | This commit is real safety hardening because it stops conflating claim identifiers with claim-key hashes across the checked journal contract and regression tests. It still remains support-only because the strongest evidence is a lab-only DB journal helper plus production-shaped checked-boundary tests rather than an independently owned production endpoint. | Production ownership of auth/session lifecycle, journal storage, rejected-remote evidence, and first-mutation revalidation in one checked release command. | Support-only |

## Release Blockers

1. `9784566b` fixes a checked-journal identity modeling flaw by separating opaque claim ids from claim-key hashes, but the proof remains helper/test scoped.
2. `scripts/playground/push-db-journal-lib.php` is explicitly lab-only, so its stronger claim-id derivation is not a production durability contract.
3. `src/recovery-journal.js` and `test/production-shaped-proof.test.js` improve checked-boundary contract validation, but they still stop at production-shaped readback rather than a production-owned Reprint endpoint.
4. There is still no checked live run proving auth/session issuance and later readback on that same production-owned boundary.
5. There is still no checked live run proving durable restart-readable journal ownership with lease fencing, preserved rejected-remote evidence, and apply-time revalidation before the first mutation on that same production-owned boundary.

## Critic Alignment

The current critic verdict at `bb169bb0b75b4ebdc1ee3a284c2b6690bad4d30c` remains aligned with this audit. For `9784566b`, both lanes agree that checked-journal identity hardening is worthwhile but still support-only because the evidence remains lab-only (`scripts/playground/push-db-journal-lib.php`) or production-shaped (`src/recovery-journal.js`, `test/production-shaped-proof.test.js`, `test/recovery-journal.test.js`) instead of proving a production-owned endpoint boundary.

## Next Primitive

The next exact production primitive remains one checked live release command on the real Reprint endpoint that proves all of the following together on the same boundary:

1. live auth/session issuance and readback
2. durable restart-readable journal ownership with lease fencing
3. preserved rejected-remote evidence
4. apply-time revalidation before the first mutation

Until that exists, the release-gate verdict stays `0/4`.
