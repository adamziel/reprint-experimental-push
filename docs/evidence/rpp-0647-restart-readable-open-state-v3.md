# RPP-0647 restart-readable open state variant 3 evidence

Date: 2026-05-31
Issue: RPP-0647
Lane: journal-recovery

## Scope

This is generated local recovery-journal coverage only. It proves restart
readability for file-backed and SQLite-mirrored open-state rows inside the
sandbox. It does not prove a live production-backed durable journal boundary,
does not change release status, and keeps final release NO-GO.

## Proof added

- Added standalone generated coverage in
  `test/rpp-0647-restart-readable-open-state-v3.test.js`.
- The file-backed proof opens claim-fenced production-shaped recovery journals
  in a child Node process, emits the writer inspection surface, exits without an
  explicit close, and rereads the journal from the parent process after that
  process boundary.
- Parent readback proves the durable `journal-opened` row, ownership row,
  target envelope rows, and active claim row are still present with monotonic
  sequences, row-level fsync markers, and a restart-readable `openState`.
- A same-claim retry appends `journal-retry-opened` after restart. The parent
  verifies the latest open-state row, claim hash, production-shaped inspection
  surface, and recovery inspection still classify the unchanged remote as
  `old-remote`.
- Stale restart state is covered by reopening the checked journal with a stale
  plan id. Inspection blocks on journal integrity and
  `openProductionRecoveryJournal()` refuses to append; record counts and open
  rows remain unchanged.
- Invalid restart state is covered by a truncated JSONL copy. Readback reports
  blocked integrity, `openState.restartReadable: false`, zero durable rows for
  open state, and refused reopen without appending retry rows.
- SQLite coverage mirrors the same hash-only rows into a local
  `recovery_journal` table, closes and reopens the database, and verifies the
  open-state summary matches file readback. A corrupt SQLite schema version
  fails closed with blocked recovery classification.
- The test builds explicit scope evidence where `localRecoverySupport.proved`
  is true and `productionBackedDurableJournalProof.proved` is false with
  `LOCAL_SANDBOX_ONLY`.

## Redaction

All journal rows and evidence summaries are checked with
`assertJournalRecordHasNoRawValues()` plus deterministic fixture payload scans.
The exposed evidence is hash-only: observed state, claim identity, latest open
row identity, and journal row identity are SHA-256-shaped hashes rather than raw
site payloads.

## Validation run

```bash
node --check test/rpp-0647-restart-readable-open-state-v3.test.js
node --test --test-name-pattern RPP-0647 test/rpp-0647-restart-readable-open-state-v3.test.js
node --test --test-name-pattern RPP-0646 test/rpp-0646-journal-pagination-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0647-restart-readable-open-state-v3.md
git diff --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0647 test passed 3 subtests, 0 failures.
- Adjacent RPP-0646 pagination test passed locally.
- Scoped artifact redaction scan was clean.
- Whitespace diff check was clean.

## Release posture

This evidence is local recovery support. Final release remains NO-GO until live
production-backed durable journal open-state evidence is checked at the release
boundary.
