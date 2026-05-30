# RPP-0622 journal ownership record variant 2 evidence

Date: 2026-05-30
Issue: RPP-0622
Lane: journal-recovery

## Scope

This is local durable journal evidence only. It uses a local file-backed seed
journal and a SQLite `recovery_journal` table in the test sandbox. Production
release status remains NO-GO for this item until live journal evidence exists.

## Proof added

- Added `RPP-0622 SQLite-backed journal ownership record is durable after
  restart` to `test/recovery-journal.test.js`.
- The regression opens a local claim-fenced production recovery journal, then
  persists the exact journal rows into a SQLite `recovery_journal` table with
  `sequence`, `schema_version`, and `record_json`.
- The test closes and reopens the SQLite database, reads it through
  `readSqliteRecoveryJournalTable()`, and verifies restart-readability through
  the same recovery inspection surface used by adjacent recovery tests.
- The durable SQLite readback must contain exactly one
  `journal-ownership-recorded` row at sequence 2. The row must match the seed
  row exactly and expose plan id, claim id/hash, hash-only journal identity,
  artifact refs, ownership contract, storage guard, and fsync evidence.
- The test asserts the persisted ownership row does not include the local JSONL
  path or SQLite path and still satisfies `assertJournalRecordHasNoRawValues()`.

## Validation

Commands run in this worktree:

```bash
node --check test/recovery-journal.test.js
node --test --test-name-pattern "RPP-0622" test/recovery-journal.test.js
node --test --test-name-pattern "ownership|restart" test/recovery-journal.test.js
node --test test/recovery-journal.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0622-journal-ownership-record-v2.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed results are recorded in the local commit report for RPP-0622.
