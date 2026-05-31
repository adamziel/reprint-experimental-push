# RPP-0666 journal pagination variant 4 evidence

Date: 2026-05-31
Issue: RPP-0666
Lane: journal-recovery

## Scope

This is generated local recovery-journal coverage only. It proves deterministic
file-backed and SQLite restart readback for journal pagination on checked local
recovery paths. It does not change release status, does not prove live
production durability, and keeps final release NO-GO.

## Proof added

- Added standalone generated coverage in
  `test/rpp-0666-journal-pagination-v4.test.js`.
- The proof creates two deterministic completed production recovery journals
  with variant-4 mutation counts and page windows, then closes and rereads the
  journals from disk.
- File-backed coverage uses `readRecoveryJournalPage()` and
  `readRecoveryJournalPaged()` to prove page windows preserve monotonic sequence
  order, `nextOffset` cursors remain restart-readable, paged readback rebuilds
  the same record set, and `inspectRecoveryJournal()` still reports
  `fully-updated-remote` on the same checked journal path.
- SQLite-backed coverage mirrors the same journal rows into a durable
  `recovery_journal` table, closes and reopens the database, then walks
  generated cursor windows over `readSqliteRecoveryJournalTable()` readback.
  The cursor envelope is bound to the checked journal path hash; invalid
  cursors, wrong-path cursors, out-of-range cursors, and invalid page limits
  throw before changing the persisted recovery state.
- Both file-backed and SQLite-backed readback assert the recovered
  `committedState` is completed, restart-readable, retains the planned target
  count, and still hash-only.
- Every paged record is checked with `assertJournalRecordHasNoRawValues()`.
  Page windows, restarted SQLite readback, cursor metadata, recovery state, and
  recovery inspections are scanned for deterministic raw fixture payloads, while
  hash fields must remain SHA-256-shaped.

## Validation run

```bash
node --check test/rpp-0666-journal-pagination-v4.test.js
node --test --test-name-pattern RPP-0666 test/rpp-0666-journal-pagination-v4.test.js
node --test --test-name-pattern RPP-0646 test/rpp-0646-journal-pagination-v3.test.js
node --test --test-name-pattern 'pagination|paged restart readback' test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0666-journal-pagination-v4.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0666 test passed locally.
- Existing RPP-0646 variant-3 journal pagination proof passed locally.
- Adjacent recovery-journal pagination/readback checks passed locally.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This is local recovery support evidence only. Final release remains NO-GO until
live production-backed durable journal pagination and release-boundary evidence
are checked.
