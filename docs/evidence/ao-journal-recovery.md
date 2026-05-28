# AO journal-recovery evidence

Date: 2026-05-28
Lane: journal-recovery
Primary range: RPP-0601 through RPP-0635

## New recovery-boundary evidence

- **Paged restart readback (RPP-0606, RPP-0626):** `readRecoveryJournalPage()` and `readRecoveryJournalPaged()` expose deterministic page metadata (`offset`, `limit`, `returned`, `totalRecords`, `nextOffset`, `hasMore`) while preserving integrity checks. `inspectRecoveryJournal({ journalPageSize })` now reconstructs inspection state through paged readback.
- **Stale lease/claim identity (RPP-0603, RPP-0604, RPP-0623, RPP-0624):** claim-fenced append events now stamp non-claim audit records with `claimId` and `claimHash`; stale claim failures include both stale and active claim identities. Production inspection scopes `consumed` and `staleClaimRejected` evidence to the active claim hash.
- **Idempotent retry (RPP-0614, RPP-0634):** reopening a production journal with the same claim appends a `journal-retry-opened` audit row instead of duplicating `target-planned` records, and rejects same-claim target-envelope drift.
- **No false commit after incomplete apply (RPP-0618, RPP-0619):** `appendJournalCompleted()` refuses to write `journal-completed` unless every planned target currently matches the after hash, leaving partial remotes classified as `blocked-recovery`.

## Verification run

- `node --test test/recovery-journal.test.js` — 21/21 tests passed.
- `npm run test:recovery:file-journal` — restart smoke passed; fail-after-2 remained `blocked-recovery` with 6 old / 2 new targets, retry did not mutate, completed replay applied 0 extra mutations, drift reported 1 blocked-unknown target.

## Files carrying evidence

- `src/recovery-journal.js`
- `src/recovery-inspect.js`
- `test/recovery-journal.test.js`
