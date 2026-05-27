Audited `9784566beb683509dde38c8e4c961ea58187ce14` (`Preserve checked journal claim identities`).

Verdict: `0/4`

Reliable advanced since supervisor baseline:
- `no`

What changed:
- `scripts/playground/push-db-journal-lib.php` now derives a separate opaque claim id from the claim-key hash via `reprint_push_lab_db_journal_claim_id_from_key_hash()` instead of reusing the hash string as both fields.
- The checked claim-contract matchers in `scripts/playground/push-db-journal-lib.php` and `src/recovery-journal.js` no longer require `activeClaimId === activeClaimKeyHash` or `previousClaimId === previousClaimKeyHash`, which removes a false identity assumption from checked durable-journal verification.
- `test/production-shaped-proof.test.js` now asserts token-shaped claim ids, SHA-256-shaped claim-key hashes, and explicit inequality between those fields in the checked production-shaped proof output.
- `test/recovery-journal.test.js` refreshes the checked durable-journal boundary contract so active and previous claim ids remain distinct from their hashes while writer leases and lease fences still have to point at the active claim identity correctly.

Why it does not move the gate:
- For `9784566b` specifically, checked journal claim identity preservation is real hardening, but it is still support-only because the strongest evidence is a lab-only helper in `scripts/playground/push-db-journal-lib.php` plus production-shaped checked-journal inspection in `src/recovery-journal.js` and the related tests.
- The diff does not prove the production-owned real Reprint endpoint boundary for live auth/session issuance and readback, durable restart-readable journal ownership with lease fencing, preserved rejected-remote evidence, and apply-time revalidation before first mutation on that same boundary.
- Separating claim ids from claim-key hashes improves correctness of the checked evidence model, but it does not change who owns execution of the checked boundary.

Critic alignment:
- `origin/lane/critic` at `bb169bb0b75b4ebdc1ee3a284c2b6690bad4d30c` classifies this same reliable head at `0/4`, and this audit agrees.

Next blocker:
- One checked live release run on the real Reprint endpoint must still prove live auth/session issuance/readback, durable restart-readable journal ownership with lease fencing, preserved rejected-remote evidence, and apply-time revalidation before the first mutation on that same boundary.
