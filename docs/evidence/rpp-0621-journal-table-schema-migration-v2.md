# RPP-0621 journal table schema migration v2 evidence

Date: 2026-05-30
Issue: RPP-0621
Lane: journal-recovery

## Proof added

- Added a focused SQLite-backed regression for a partially migrated journal
  table: the table already has durable `schema_version = 1` rows, but the
  stored `record_json` payloads are legacy records missing `schemaVersion`.
- The strict SQLite reader blocks that state before migration with
  `JOURNAL_SCHEMA_UNSUPPORTED`, while confirming this is not the older missing
  table-column case.
- `migrateSqliteRecoveryJournalTableSchema()` rewrites every legacy JSON
  payload in place without adding a duplicate schema column, preserves row
  order and non-schema row data, and reports restart-readable integrity.
- The migrated table is closed and reopened from the SQLite file, then read
  back through `readSqliteRecoveryJournalTable()` to prove the state survives a
  restart boundary.
- The restarted SQLite journal is fed to recovery inspection with a partially
  updated remote. Recovery remains fail-closed as `blocked-recovery` with
  3 new / 5 old / 0 blocked-unknown targets, proving migration preserved the
  committed recovery envelope.

## Focused regression

`test/recovery-journal.test.js` now includes
`RPP-0621 SQLite-backed journal table schema migration v2 preserves partial recovery state`:

1. Seeds a normal plan recovery journal, applies three mutations to a cloned
   current state, and appends three `mutation-observed` rows.
2. Copies those rows into a SQLite table that already records table schema
   version 1 while intentionally omitting per-record `schemaVersion` from
   `record_json`.
3. Confirms strict readback blocks the table before migration.
4. Runs the migration and asserts `schemaVersionColumnAdded: false`, all rows
   updated, rows preserved ignoring only schema fields, and committed-state
   readback remains restart-readable.
5. Reopens the SQLite database file and verifies recovery inspection reports
   the expected partial-update `blocked-recovery` state.

## Validation run

```bash
node --check test/recovery-journal.test.js
node --test --test-name-pattern "RPP-0621" test/recovery-journal.test.js
```

Observed result: 1 pass / 0 fail for the focused RPP-0621 SQLite-backed proof.

## Residual risk

- This is a SQLite-backed sandbox proof. MySQL and live production endpoint
  evidence were not exercised in this slice.
- This does not move final release status; release remains NO-GO until the live
  production verifier proves the durable journal boundary on a production-owned
  source path.
