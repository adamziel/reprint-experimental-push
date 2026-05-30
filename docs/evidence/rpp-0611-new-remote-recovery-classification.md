# RPP-0611 new remote recovery classification evidence

Date: 2026-05-30
Issue: RPP-0611
Lane: journal-recovery

## Proof added

- Added a SQLite-backed restart inspection regression for the all-new remote
  state.
- The test writes a completed hash-only recovery journal into a SQLite
  `recovery_journal` table with schema version 1 rows, closes and reopens the
  database file, and reads it through `readSqliteRecoveryJournalTable()`.
- The restarted SQLite journal is fed to `inspectRecoveryJournal()` with the
  current remote already at every planned after hash.
- The asserted recovery state is `fully-updated-remote`, with 0 old targets, 8
  new targets, 0 blocked-unknown targets, and every target classified as `new`.
- The same test also checks the restart-readable committed-state envelope:
  planned targets, committed targets, and all-targets-committed all match the
  plan mutation count.

## Focused validation

```bash
node --test --test-name-pattern "SQLite-backed restart inspection classifies an all-new remote as fully updated" test/recovery-journal.test.js
```

Observed result: 1 pass / 0 fail.

## Files carrying evidence

- `test/recovery-journal.test.js`
- `docs/evidence/rpp-0611-new-remote-recovery-classification.md`
- `docs/reprint-push-completion-checklist.md`
