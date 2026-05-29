# RPP-0601 journal table schema migration evidence

Date: 2026-05-29
Issue: RPP-0601
Lane: journal-recovery

## Proof added

- Added a SQLite-backed recovery journal table migration surface:
  `migrateSqliteRecoveryJournalTableSchema(database, { tableName })` and
  `readSqliteRecoveryJournalTable(database, { tableName })`.
- The migration accepts a legacy append-only SQLite table with `sequence` and
  `record_json` rows, adds a durable `schema_version` column, and rewrites each
  legacy JSON record to include `schemaVersion: 1`.
- The migration summary reports the SQLite table name, recorded table and record
  schema versions, migrated row counts, row-preservation status, and strict
  restart-readability.
- Unsupported explicit schema versions still fail closed through the strict table
  reader; un-migrated legacy table rows remain blocked until the migration runs.
- The previous file-backed JSONL migration proof remains covered as auxiliary
  evidence for the same restart-readable recovery journal state.

## Focused regression

`test/recovery-journal.test.js` now includes
`SQLite-backed journal table schema migration preserves rows and remains restart-readable`:

1. Creates a normal plan recovery journal and copies its rows into a legacy
   SQLite journal table after removing only `schemaVersion` from each JSON row.
2. Confirms the strict SQLite table reader blocks the legacy table because the
   `schema_version` column and per-record schema versions are missing.
3. Runs `migrateSqliteRecoveryJournalTableSchema()` and asserts the migration
   adds `schema_version`, preserves row order and non-schema row data, records
   `schemaVersion: 1`, and reports restart-readable integrity.
4. Closes and reopens the SQLite database file, reads the table again, and
   verifies every persisted row still records table and record schema version 1.
5. Feeds the restarted SQLite table journal into recovery inspection and verifies
   the recovery state remains `old-remote` with 8 old / 0 new / 0
   blocked-unknown targets.

The existing file-backed regression continues to verify the auxiliary JSONL
migration path.

## Validation run

```bash
umask 0022 && node --test test/recovery-journal.test.js
```

Observed result: 23 pass / 0 fail, including the SQLite-backed journal table
schema migration and existing recovery journal coverage.
