# RPP-0642 journal ownership record variant 3 evidence

Date: 2026-05-31
Issue: RPP-0642
Lane: journal-recovery

## Scope

This is local recovery support evidence only. It uses sandbox file-backed and
SQLite-backed recovery journals to prove restart/readback behavior. Final
release status remains NO-GO without external durability or production-backed
release proof.

## Proof added

- Added standalone coverage in
  `test/rpp-0642-journal-ownership-record-v3.test.js`.
- The file-backed case opens a claim-fenced production recovery journal, checks
  the inspection summary exposes the ownership record owner identity, closes the
  journal, reads it back from disk, and verifies the persisted
  `journal-ownership-recorded` row is still present exactly once.
- The SQLite case copies the same journal rows into a local
  `recovery_journal` table, closes and reopens the database, and proves
  `readSqliteRecoveryJournalTable()` returns the same ownership row after
  restart.
- Both cases require the ownership row to expose the claim id, claim hash,
  hash-only journal identity, ownership contract, fsync evidence, and append
  storage guard.
- Both cases scan the ownership evidence and restarted journal records for the
  deterministic raw site values used by the fixture, and assert
  `assertJournalRecordHasNoRawValues()` accepts the ownership row.

## Validation run

```bash
node --check test/rpp-0642-journal-ownership-record-v3.test.js
node --test test/rpp-0642-journal-ownership-record-v3.test.js
node --test --test-name-pattern 'production recovery journal ownership record|RPP-0622' test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0642-journal-ownership-record-v3.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0642 test passed 2 subtests, 0 failures.
- Adjacent RPP-0602/RPP-0622 ownership pattern passed 2 subtests, 0
  failures.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.
