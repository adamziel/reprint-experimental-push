# RPP-0601 journal table schema migration evidence

Date: 2026-05-28
Issue: RPP-0601
Lane: journal-recovery

## Proof added

- Added `migrateRecoveryJournalSchema(filePath)` for the file-backed recovery
  journal surface.
- The migration accepts legacy append-only journal rows that are otherwise valid
  but lack `schemaVersion`, rewrites them atomically through a fsynced temporary
  file and rename, and records `schemaVersion: 1` on every row.
- The migration summary reports total rows, migrated row count, distinct recorded
  schema versions, row-preservation status, and restart-readability.
- Unsupported explicit schema versions still fail closed; un-migrated legacy rows
  remain blocked by `readRecoveryJournal()` until the migration runs.

## Focused regression

`test/recovery-journal.test.js` now includes
`file-backed journal schema migration preserves rows and remains restart-readable`:

1. Creates a normal plan recovery journal.
2. Rewrites it into a legacy fixture by removing only `schemaVersion` from each
   JSONL row.
3. Confirms the legacy fixture is blocked as `JOURNAL_SCHEMA_UNSUPPORTED` before
   migration.
4. Runs `migrateRecoveryJournalSchema()` and asserts row count, sequence order,
   non-schema row data, and `schemaVersion: 1` are preserved.
5. Reopens the migrated journal through restart inspection and verifies the
   recovery state remains `old-remote` with 8 old / 0 new / 0 blocked-unknown
   targets.

## Validation run

```bash
node --test test/recovery-journal.test.js
npm run test:recovery:file-journal
```

Both focused checks passed in this worktree after the migration patch.
