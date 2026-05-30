# RPP-0612 blocked recovery classification evidence

Date: 2026-05-30
Issue: RPP-0612
Lane: journal-recovery

## Proof added

- Added a focused SQLite-backed recovery journal regression for the blocked
  recovery classification path.
- The test runs the journal writer in a child Node process, records a hash-only
  partial remote state with 2 of 8 planned targets observed, writes those rows
  into a SQLite `recovery_journal` table with schema version 1, closes the
  database, and lets the writer process exit.
- The parent process reopens the SQLite file, reads it with
  `readSqliteRecoveryJournalTable()`, and verifies monotonic durable rows after
  restart-style readback.
- Restart inspection reports `blocked-recovery` with counts
  `{ old: 6, new: 2, blockedUnknown: 0 }`; the two observed targets are `new`
  and the remaining planned targets stay `old`.
- The committed-state envelope remains restart-readable while explicitly
  showing that not all planned targets were committed.
- The persisted row payloads are checked for the private base/local fixture
  strings; only hash and metadata evidence is retained.

## Focused validation

```bash
node --test --test-name-pattern 'RPP-0612' test/recovery-journal.test.js
```

Observed result: 1 pass / 0 fail.

## Residual scope

This evidence is limited to local SQLite-backed blocked recovery
classification. It does not touch generated harness, release verifier,
plugin-driver, executor-auth idempotency, or storage-performance surfaces.
