# RPP-0648 restart-readable staged state variant 3 evidence

Date: 2026-05-31
Issue: RPP-0648
Lane: journal-recovery

## Scope

This is generated local recovery-journal coverage only. It proves restart
readability for file-backed and SQLite-mirrored staged-state rows inside the
sandbox. It does not prove a live production-backed durable journal boundary,
does not change release status, and keeps final release NO-GO.

## Proof added

- Added standalone generated coverage in
  `test/rpp-0648-restart-readable-staged-state-v3.test.js`.
- The file-backed proof opens claim-fenced production-shaped recovery journals
  in a child Node process, stages all planned targets through `applyPlan()`,
  exits at the injected post-staging failure boundary without an explicit close,
  and rereads the journal from the parent process after that process boundary.
- Parent readback verifies the durable `apply-staged` row, target envelope,
  ownership row, active claim row, recovery-state row, monotonic sequences,
  row-level fsync markers, and restart-readable `stagedState`.
- A same-claim production retry appends only a new `journal-retry-opened` row.
  The staged row remains the latest staged evidence, and recovery replay applies
  only planned targets while preserving remote-only changes that existed before
  planning and after the simulated crash.
- Stale restart state is covered by reopening the checked journal with a stale
  plan id. Inspection and repair both block recovery, the production reopen
  refuses to append, and row counts remain unchanged.
- Invalid restart state is covered by a truncated JSONL copy. Readback reports
  blocked integrity, `stagedState.restartReadable: false`, zero durable rows for
  staged state, blocked inspection and repair, and refused reopen without
  appending retry rows.
- SQLite coverage mirrors the same hash-only rows into a local
  `recovery_journal` table, closes and reopens the database, and verifies the
  staged-state summary matches file readback. A corrupt SQLite schema version
  fails closed with blocked recovery classification.
- The test builds explicit scope evidence where `localRecoverySupport.proved`
  is true and `productionBackedDurableJournalProof.proved` is false with
  `LOCAL_SANDBOX_ONLY`.

## Redaction

All journal rows and evidence summaries are checked with
`assertJournalRecordHasNoRawValues()` plus deterministic fixture payload scans.
The exposed evidence is hash-only: observed state, staged state, claim identity,
latest staged row identity, and journal row identity are SHA-256-shaped hashes
rather than raw site payloads.

## Validation run

```bash
node --check test/rpp-0648-restart-readable-staged-state-v3.test.js
node --test --test-name-pattern RPP-0648 test/rpp-0648-restart-readable-staged-state-v3.test.js
node --test --test-name-pattern RPP-0647 test/rpp-0647-restart-readable-open-state-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0648-restart-readable-staged-state-v3.md
git diff --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0648 test passed 3 subtests, 0 failures.
- Adjacent RPP-0647 open-state test passed 3 subtests, 0 failures.
- Scoped artifact redaction scan was clean.
- Whitespace diff check was clean.

## Release posture

This evidence is local recovery support. Final release remains NO-GO until live
production-backed durable journal staged-state evidence is checked at the
release boundary.
