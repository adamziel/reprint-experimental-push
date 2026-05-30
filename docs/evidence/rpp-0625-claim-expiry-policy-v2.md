# RPP-0625 claim expiry policy v2 evidence

Date: 2026-05-30
Issue: RPP-0625
Lane: recovery

## Proof added

- Added a focused SQLite-backed recovery journal regression:
  `RPP-0625 SQLite claim expiry proof keeps production release claim NO-GO without live evidence`.
- The test opens a production recovery journal, advances an expired active claim
  with a different retry claim, copies the durable JSONL rows into a SQLite
  `recovery_journal` table with schema version rows, closes and reopens SQLite,
  and reads the restarted table through `readSqliteRecoveryJournalTable()`.
- The restarted SQLite journal is inspected as `old-remote`, then used as the
  durable journal source for `buildDurableRecoveryJournalReleaseProof()`. The
  release proof reports `GATE-2`, `gateStatus: proven`,
  `claimExpiryPolicy.proved: true`, and the same old-remote counts from the
  restarted journal.
- The same test asserts the SQLite fixture is rejected by
  `checkedDurableJournalBoundarySatisfied()`, because it is local
  `sqlite-local-durable-fixture` evidence and not checked live
  `wpdb-single-statement-cas` durable journal evidence.

## Release posture

This is support evidence for the claim expiry policy. Final production release
claims remain `NO-GO` unless a checked live release path supplies production
durable journal ownership, lease fence, stale-claim rejection, and claim expiry
evidence.

## Validation

Commands run for this slice:

```bash
node --check test/recovery-journal.test.js
node --test --test-name-pattern 'RPP-0625' test/recovery-journal.test.js
node --test --test-name-pattern 'claim|stale|expiry' test/recovery-journal.test.js
node --test test/recovery-journal.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0625-claim-expiry-policy-v2.md docs/reprint-push-completion-checklist.md
```

Observed result: all commands exited 0. Focused RPP-0625 coverage ran 1
subtest, adjacent claim/stale/expiry coverage ran 9 subtests, and the merged
lane full `test/recovery-journal.test.js` ran 31 subtests.
