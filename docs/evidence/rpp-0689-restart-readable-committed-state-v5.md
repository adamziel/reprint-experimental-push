# RPP-0689 restart-readable committed state variant 5 evidence

Date: 2026-05-31
Issue: RPP-0689
Lane: journal-recovery

## Scope

This is generated local recovery-journal and release-verifier-shaped coverage
only. It proves restart readability for file-backed and SQLite-mirrored
committed-state rows inside the sandbox, then carries the committed lease-owner
identity into hash-only release verifier audit evidence. It does not prove a
live production-backed durable journal boundary, does not change release
status, and keeps final release NO-GO.

## Proof added

- Added standalone generated coverage in
  `test/rpp-0689-restart-readable-committed-state-v5.test.js`.
- The file-backed proof opens claim-fenced production-shaped recovery journals
  in a child Node process, applies every planned target through `applyPlan()`,
  exits after the durable `journal-completed` row without an explicit close, and
  rereads the journal from the parent process after that process boundary.
- Parent readback verifies the durable `mutation-observed` rows, terminal
  `journal-completed` row, ownership row, active claim row, target envelope,
  staged/committing boundary rows, monotonic sequences, row-level fsync markers,
  and restart-readable `committedState`.
- The committed audit evidence exposes lease owner identity after restart:
  `committedState.leaseOwner.visible` is true, the source row is
  `journal-completed`, the claim id is present in the audit summary, and the
  claim hash/key hash match the production `writerLease` and
  `leaseFence.writerLease` surfaces.
- The release-verifier-shaped proof seeds an active claim, advances an expired
  retry claim, writes committed rows in a child process, and feeds the
  restarted committed journal into `buildDurableRecoveryJournalReleaseProof()`.
  The resulting `GATE-2` support proof reports
  `durableRecoveryJournalBoundary: release-verifier`,
  `leaseOwnerIdentity.matches: true`, and a hash-only manual recovery audit
  export whose `committedStateLeaseOwner.identityVisible` is true.
- A same-claim production retry appends only a new `journal-retry-opened` row.
  The completed row remains the latest committed evidence, and restart
  inspection still classifies the committed remote as `fully-updated-remote`
  while preserving lease owner audit identity.
- Stale restart state is covered by reopening the checked journal with a stale
  plan id. Inspection blocks on journal integrity, the production reopen
  refuses to append, and row counts plus completed-state evidence remain
  unchanged.
- Invalid restart state is covered by a truncated JSONL copy. Readback reports
  blocked integrity, `committedState.restartReadable: false`, zero durable rows
  for committed state, retained hash-bound lease owner evidence, blocked
  inspection, and refused reopen without appending retry rows.
- SQLite coverage mirrors the same hash-only rows into a local
  `recovery_journal` table, closes and reopens the database, and verifies the
  committed-state summary matches file readback. A corrupt SQLite schema version
  fails closed with blocked recovery classification.
- The test builds explicit scope evidence where `localRecoverySupport.proved`
  is true and `productionBackedDurableJournalProof.proved` is false with
  `LOCAL_SANDBOX_ONLY`.

## Redaction

All journal rows and evidence summaries are checked with
`assertJournalRecordHasNoRawValues()` plus deterministic fixture payload scans.
The exposed evidence is scoped to generated claim identity plus hash-only
state: observed state, latest committed row identity, journal row identity,
release proof identity fields, and lease owner claim/key hashes are
SHA-256-shaped values rather than raw site payloads, secrets, or bearer tokens.

## Validation run

```bash
node --check test/rpp-0689-restart-readable-committed-state-v5.test.js
node --test --test-name-pattern RPP-0689 test/rpp-0689-restart-readable-committed-state-v5.test.js
node --test --test-name-pattern RPP-0669 test/rpp-0669-restart-readable-committed-state-v4.test.js
node --test --test-name-pattern RPP-0649 test/rpp-0649-restart-readable-committed-state-v3.test.js
node --test --test-name-pattern RPP-0629 test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0689-restart-readable-committed-state-v5.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0689 test passed 4 subtests, 0 failures.
- Predecessor RPP-0669 committed-state test passed 3 subtests, 0 failures.
- Predecessor RPP-0649 committed-state test passed 3 subtests, 0 failures.
- Recovery-journal RPP-0629 committed-state test passed 1 subtest, 0 failures.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This evidence is local recovery support. Final release remains NO-GO until live
production-backed durable journal committed-state evidence is checked at the
release boundary.
