# RPP-0662 journal ownership record variant 4 evidence

Date: 2026-05-31
Issue: RPP-0662
Lane: journal-recovery

## Scope

This is local recovery support evidence only. It uses sandbox file-backed and
SQLite-backed recovery journals to prove journal rows remain durable after a
process restart. Final release status remains NO-GO without external durability
or production-backed release proof.

## Proof added

- Added standalone coverage in
  `test/rpp-0662-journal-ownership-record-v4.test.js`.
- The file-backed case opens a claim-fenced production recovery journal,
  closes the writer, reads the seed rows, then reads the same JSONL journal from
  a fresh Node process to model restart readback.
- The SQLite case copies the same seed rows into a local `recovery_journal`
  table, closes the database, and reads the table from a fresh Node process
  through `readSqliteRecoveryJournalTable()`.
- Both restart readbacks require the complete row set to match the seeded rows:
  monotonic sequences, one ownership row, all planned target rows, and one
  claim-opened row.
- Both ownership rows must expose the claim id, claim hash, hash-only journal
  identity, ownership contract, fsync evidence, and append storage guard.
- Both cases scan the ownership evidence and restarted rows for the
  deterministic raw site values used by the fixture, and assert
  `assertJournalRecordHasNoRawValues()` accepts the ownership row.

## Validation run

```bash
node --check test/rpp-0662-journal-ownership-record-v4.test.js
node --test --test-name-pattern RPP-0662 test/rpp-0662-journal-ownership-record-v4.test.js
node --test --test-name-pattern RPP-0642 test/rpp-0642-journal-ownership-record-v3.test.js
node --test --test-name-pattern RPP-0622 test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0662-journal-ownership-record-v4.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0662 test passed 2 subtests, 0 failures.
- Adjacent RPP-0642 ownership readback proof passed 2 subtests, 0 failures.
- Adjacent RPP-0622 SQLite ownership proof passed 1 subtest, 0 failures.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.
