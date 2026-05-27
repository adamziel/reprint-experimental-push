Audited `0512cd2792b1bda976ea0aeb0ff0ad55d9fcac19` (`Preserve packaged checked claim identities`).

Verdict: `0/4`

What changed:
- `scripts/playground/push-db-journal-lib.php` now reconstructs the latest claim, stale-claim retry row, and previous claim from packaged journal rows before building the checked summary, then mirrors `activeClaimId` / `activeClaimKeyHash` into `writerLease` and `leaseFence.writerLease`.
- The packaged journal summary now advertises `supportedSurface: claim-fenced-restart-readable`, `productionAdapter: wpdb-single-statement-cas`, `fsyncEvidence: true`, and the same writer-lease claim identity fields that the checked boundary expects.
- `scripts/playground/push-remote-rest-plugin.php` now copies packaged `claimId` and `claimKeyHash` fields into the recovery-journal `writerLease` and `leaseFence.writerLease` payloads whenever the active checked claim is present.
- `test/production-shaped-proof.test.js` adds packaged proof assertions that the checked packaged path exposes opaque `psh_...` claim ids and 64-hex claim-key hashes in both `recoveryInspect.journal` and `dbJournal`.

Why it does not move the gate:
- This is still packaged checked-path hardening, not production-owned endpoint proof. The core implementation under review is still `scripts/playground/push-db-journal-lib.php` and `scripts/playground/push-remote-rest-plugin.php`.
- The route profile on the same audited head still comes from the Playground REST plugin. In package mode it flips `labBacked` to `false`, but it does so inside the same Playground-owned file and only changes the warning string; that is not independent evidence of a production-owned Reprint endpoint.
- The new tests only prove that packaged verifier output now includes the expected checked claim identity fields. They do not prove live auth/session issuance and readback, durable restart-readable journal ownership with lease fencing, Playground-independent plugin-driver proof, preserved rejected-remote evidence, or apply-time revalidation before first mutation on the real boundary.

Evidence reviewed:
- `0512cd279:scripts/playground/push-db-journal-lib.php:533-645`
- `0512cd279:scripts/playground/push-remote-rest-plugin.php:263-278`
- `0512cd279:scripts/playground/push-remote-rest-plugin.php:570-592`
- `0512cd279:test/production-shaped-proof.test.js:4130-4167`
- `09a06d4dfc2aebeb3aa46369d22a45bd2dcd12bb` (`Classify reliable head 0512cd279`)

Critic alignment:
- `origin/lane/critic` at `09a06d4dfc2aebeb3aa46369d22a45bd2dcd12bb` also keeps the verdict at `0/4`, and this audit agrees.

Next blocker:
- One checked live release run on the real Reprint endpoint must still prove live auth/session issuance/readback, durable restart-readable journal ownership with lease fencing, plugin-driver ownership on the release boundary, preserved rejected-remote evidence, and apply-time revalidation before the first mutation.
