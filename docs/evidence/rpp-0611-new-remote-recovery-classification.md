# RPP-0611 new remote recovery classification evidence

Date: 2026-05-30
Checklist item: RPP-0611 (Far / recovery) Implement new remote recovery classification, variant 1.

## Implementation

- `inspectRecoveryJournal()` now carries an explicit `remoteRecoveryClassification` summary alongside the existing recovery `status`.
- A completed, restart-readable journal whose every planned target matches its after hash is classified as `kind: "new-remote"` with state `fully-updated-remote`, hash-count totals, journal integrity, and storage adapter metadata.
- Old-remote and blocked-recovery inspections keep their existing top-level states while receiving the same summary shape for consumers that need the explicit remote class.

## SQLite-backed proof

Focused coverage in `test/recovery-journal.test.js` seeds a completed recovery journal, copies its rows into a SQLite-backed `recovery_journal` table, restarts through `readSqliteRecoveryJournalTable()`, and verifies:

- SQLite journal integrity is `ok`.
- The committed journal state is restart-readable as `completed`.
- `inspectRecoveryJournal()` returns `fully-updated-remote`.
- `remoteRecoveryClassification.kind` is `new-remote` with counts `{ old: 0, new: 8, blockedUnknown: 0, total: 8 }` and `storage: "sqlite"`.

## Verification

- `node --test test/recovery-journal.test.js test/recovery-repair.test.js` — pass, 34 tests.
- `git diff --check` — pass.
- `node scripts/release/checklist-completion-lint.mjs` — pass.
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence audits progress.html` — pass.

## Files

- `src/recovery-inspect.js`
- `test/recovery-journal.test.js`
- `docs/evidence/rpp-0611-new-remote-recovery-classification.md`
- `docs/reprint-push-completion-checklist.md`
