# RPP-0661 journal table schema migration v4 evidence

Date: 2026-05-31
Issue: RPP-0661
Lane: journal-recovery

## Proof added

- Added focused SQLite-backed regression coverage in
  `test/rpp-0661-journal-table-schema-migration-v4.test.js`.
- The test seeds a completed durable recovery journal through `applyPlan()`,
  then copies the restart-readable rows into a SQLite `recovery_journal` table
  that already has a `schema_version` column.
- Variant 4 intentionally stores a mixed legacy table state:
  - some table rows have `schema_version = NULL`;
  - some `record_json` payloads omit per-record `schemaVersion`;
  - some rows are already current, proving migration preserves mixed current and
    legacy rows without adding a duplicate schema column.
- Strict SQLite readback fails closed before migration with
  `JOURNAL_TABLE_SCHEMA_UNSUPPORTED` and `JOURNAL_SCHEMA_UNSUPPORTED`, while
  confirming this is not the older missing-column case.
- `migrateSqliteRecoveryJournalTableSchema()` updates the legacy rows in place,
  preserves row order and non-schema payload data, reports restart-readable
  integrity, and keeps `schemaVersionColumnAdded: false`.
- The migrated database is closed and reopened from disk. Restart inspection
  proves the completed recovery state as `fully-updated-remote` with all planned
  targets classified as new from the SQLite-backed journal.

## Support boundary

This is SQLite-backed sandbox regression coverage for the journal table
migration path. It is not MySQL, live production, or external durability
evidence. It supports the migration recovery-state proof but does not change
the final release gate by itself.

## Validation run

```bash
node --check test/rpp-0661-journal-table-schema-migration-v4.test.js
node --test --test-name-pattern RPP-0661 test/rpp-0661-journal-table-schema-migration-v4.test.js
node --test --test-name-pattern RPP-0641 test/rpp-0641-journal-table-schema-migration-v3.test.js
node --test --test-name-pattern RPP-0621 test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0661-journal-table-schema-migration-v4.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0661 SQLite migration proof passed 1 subtest, 0 failures.
- Adjacent RPP-0641 variant 3 migration proof passed 1 subtest, 0 failures.
- Adjacent RPP-0621 migration v2 proof passed 1 subtest, 0 failures.
- Scoped artifact redaction scan plus unstaged and staged whitespace diff checks
  were clean.
