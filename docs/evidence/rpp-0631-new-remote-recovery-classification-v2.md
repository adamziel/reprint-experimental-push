# RPP-0631 new remote recovery classification, variant 2

Date: 2026-05-30
Issue: RPP-0631
Lane: recovery

## Proof added

- Added focused SQLite-backed recovery journal evidence for the completed apply
  classification path.
- The regression persists a completed recovery journal into a SQLite
  `recovery_journal` table with durable `schema_version` metadata, closes and
  reopens the database, then reads it through `readSqliteRecoveryJournalTable()`.
- Restart inspection over the reopened SQLite journal proves the current remote
  is `fully-updated-remote` with all planned targets classified as `new`.
- The same journal is also inspected against the unchanged pre-apply remote to
  prove the classification is hash-derived from the live current state rather
  than inferred only from the `journal-completed` row.

## Focused regression

`test/recovery-journal.test.js` now includes
`RPP-0631 SQLite-backed restart inspection proves new remote recovery classification`:

1. Builds the standard eight-target recovery plan.
2. Applies every planned mutation to an in-memory current site and appends
   `journal-completed`.
3. Copies the completed JSONL recovery records into a SQLite journal table with
   `schema_version = 1`.
4. Reopens SQLite, verifies table and record schema versions, monotonic
   sequences, and restart-readable completed state.
5. Runs `inspectRecoveryJournal()` and verifies `fully-updated-remote`, 0 old,
   8 new, 0 blocked-unknown, and every target's observed hash equals its
   journaled after hash.
6. Re-runs inspection against the unchanged remote and verifies it reports
   `old-remote`, keeping the new classification tied to current target hashes.

## Validation run

```bash
umask 0022 && node --test --test-name-pattern 'RPP-0631' test/recovery-journal.test.js
umask 0022 && node --test --test-name-pattern 'old remote|RPP-0631|blocked recovery|fully updated no-op|drifts outside' test/recovery-journal.test.js
umask 0022 && node --test test/recovery-journal.test.js
umask 0022 && node scripts/release/checklist-completion-lint.mjs
umask 0022 && node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0631-new-remote-recovery-classification-v2.md
umask 0022 && git diff --check
umask 0022 && git diff --cached --check
```

Observed local result: all commands exited 0 in this worktree.

## Residual scope

This evidence is limited to the recovery journal classification surface for
SQLite-backed new-remote restart inspection. It does not cover generated
harnesses, plugin-driver behavior, executor-auth replay, storage benchmark
lanes, or release progress artifacts.
