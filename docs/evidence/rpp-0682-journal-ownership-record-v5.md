# RPP-0682 journal ownership record release verifier variant 5 evidence

Date: 2026-05-31
Issue: RPP-0682
Lane: journal-recovery

## Scope

This is focused local recovery-journal regression coverage. It proves
claim-fenced journal ownership rows are durable after process restart and that
the restarted ownership evidence is carried through the local
release-verifier-shaped durable recovery gate helper. Final release status
remains NO-GO until equivalent production-owned durable storage and live
release-boundary evidence are checked outside the sandbox.

## Proof added

- Added standalone coverage in
  `test/rpp-0682-journal-ownership-record-v5.test.js`.
- The file-backed case opens an active production recovery journal claim, then
  advances an expired retry claim on the same JSONL path. After closing the
  writer, a fresh Node process reads the journal back and must return the exact
  persisted row set.
- The file-backed restart readback requires monotonic sequences, one active
  claim-opened row, one stale-claim-advanced row, all planned target rows, and
  durable `journal-ownership-recorded` rows for both the original and retry
  claims.
- The restarted old-remote inspection is attached to the same checked recovery
  path and consumed by `buildDurableRecoveryJournalReleaseProof()`. The helper
  reports `gate: GATE-2`, `durableRecoveryJournalBoundary: release-verifier`,
  `gateStatus: proven`, `sameReleaseBoundary: true`,
  `checks.ownsJournal: true`, `checks.restartReadable: true`,
  `checks.leaseOwnerIdentity: true`, and
  `checks.recoveryInspectAfterRestart: true`.
- The SQLite case copies the same seeded journal rows into a local
  `recovery_journal` table, closes the database, then reads the table from a
  fresh Node process through `readSqliteRecoveryJournalTable()`.
- Both restart readbacks require the ownership rows to expose claim id, claim
  hash, hash-only journal identity, artifact refs, ownership contract, fsync
  evidence, and append storage guard.
- Persisted rows, restart inspections, release-verifier proof evidence, and the
  raw JSONL file are scanned for the deterministic fixture payloads. Every
  ownership row also satisfies `assertJournalRecordHasNoRawValues()`.

## Validation run

```bash
node --check test/rpp-0682-journal-ownership-record-v5.test.js
node --test --test-name-pattern RPP-0682 test/rpp-0682-journal-ownership-record-v5.test.js
node --test --test-name-pattern RPP-0662 test/rpp-0662-journal-ownership-record-v4.test.js
node --test --test-name-pattern RPP-0642 test/rpp-0642-journal-ownership-record-v3.test.js
node --test --test-name-pattern RPP-0622 test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0682-journal-ownership-record-v5.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0682 test passed 2 subtests, 0 failures.
- Adjacent RPP-0662 ownership proof passed 2 subtests, 0 failures.
- Adjacent RPP-0642 ownership proof passed 2 subtests, 0 failures.
- Adjacent RPP-0622 SQLite ownership coverage passed 1 subtest, 0 failures.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This is local support evidence only. It does not change release status, does
not claim production-backed release readiness, and keeps final release NO-GO.
