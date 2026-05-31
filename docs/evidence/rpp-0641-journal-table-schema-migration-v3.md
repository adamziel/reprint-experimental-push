# RPP-0641 journal table schema migration v3 evidence

Date: 2026-05-31
Issue: RPP-0641
Lane: journal-recovery

## Proof added

- Added standalone generated-style coverage in
  `test/rpp-0641-journal-table-schema-migration-v3.test.js`.
- The test builds three deterministic SQLite migration cases:
  - open recovery journal rows copied into a legacy table without
    `schema_version`;
  - staged recovery journal rows copied into a table with durable
    `schema_version = 1` but legacy JSON records missing `schemaVersion`;
  - committed partial recovery rows copied into a mixed table where current and
    legacy JSON records coexist under `schema_version = 1`.
- Each case first proves strict SQLite readback fails closed before migration,
  then runs `migrateSqliteRecoveryJournalTableSchema()` and verifies the
  migrated table records schema version metadata, row counts, and row
  preservation.
- Each migrated SQLite database is closed and reopened from disk, then read via
  `readSqliteRecoveryJournalTable()` to prove restart-readability from
  SQLite-backed journal storage.
- The restarted journals preserve open, staged, and committed recovery summaries
  as appropriate, including committed target counts for the partial commit case.

## Support boundary

This is generated-style SQLite recovery coverage only. It is support evidence
for the journal table migration path and is not live production or external
durability evidence. Final release remains NO-GO unless live production or
external durability evidence exists.

## Validation run

```bash
node --check test/rpp-0641-journal-table-schema-migration-v3.test.js
node --test test/rpp-0641-journal-table-schema-migration-v3.test.js
node --test --test-name-pattern 'file-backed journal schema migration|SQLite-backed journal table schema migration|RPP-0621' test/recovery-journal.test.js
node --test --test-name-pattern 'schema migration|restart-readable|staged state|committed-state|open state' test/recovery-journal.test.js test/rpp-0641-journal-table-schema-migration-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0641-journal-table-schema-migration-v3.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0641 test passed 1 subtest, 0 failures.
- Adjacent RPP-0601/RPP-0621 schema pattern passed 3 subtests, 0 failures.
- Broader recovery schema/restart-readable pattern passed 10 subtests,
  0 failures.
- Scoped artifact redaction scan plus unstaged and staged whitespace diff checks
  were clean.
