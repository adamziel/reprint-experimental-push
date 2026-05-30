# RPP-0612 blocked recovery classification evidence

Date: 2026-05-30
Issue: RPP-0612
Lane: recovery

## Proof added

- Recovery inspection now exposes a hash-only `classification` summary alongside
  the existing recovery `status`. For blocked partial remotes, the summary uses
  reason code `BLOCKED_PARTIAL_REMOTE`, reports the restart-read durable row
  count, and marks retry disposition as `blocked`.
- The classification summary contains only state, reason code, journal
  integrity, durable row count, retry disposition, and old/new/unknown target
  counts. It does not carry before or after payload values.
- Existing old-remote, fully-updated-remote, journal-integrity-blocked, and
  target-unknown states receive explicit reason codes without changing their
  existing status strings.

## Focused regression

`test/rpp-0612-blocked-recovery-classification.test.js` proves the blocked
classification across a process restart:

1. A child Node process opens a claim-fenced file recovery journal and runs the
   normal apply path with a deterministic failure after the first committed
   mutation.
2. The child exits without closing the writer; the parent process re-reads the
   JSONL journal from disk and verifies integrity is `ok`, sequence numbers are
   monotonic, `mutation-observed` and `recovery-state` rows are present, and all
   rows carry `fsync.requested: true`.
3. The restarted inspection sees one target at the after hash and two targets at
   the before hash, classifies the state as `blocked-recovery`, and reports
   `BLOCKED_PARTIAL_REMOTE` with retry disposition `blocked`.
4. The test scans the journal text, parsed journal, and inspection result for
   the fixture payload strings and asserts none are present.

## Supplemental recovery-journal regression

`test/recovery-journal.test.js` also covers
`file-backed journal blocked recovery classification survives process restart`.
The regression runs a separate Node writer process against a claim-fenced
file-backed recovery journal, injects a failure after two committed mutations,
and then re-reads the JSONL journal in the parent process.

The restarted readback verifies integrity is `ok`, sequence numbers are
monotonic, all planned targets are durable, two `mutation-observed` rows remain
present, no `journal-completed` row was written, each row carries fsync
evidence, and the persisted recovery-state row is `blocked-recovery`.
Inspection of the partial remote reports 2 new targets, 6 old targets, and 0
blocked-unknown targets, proving the classification is derived from durable
journal rows rather than in-memory apply state.

## Supplemental SQLite regression

`test/recovery-journal.test.js` also carries
`RPP-0612 SQLite-backed blocked recovery rows survive process restart`. The
regression runs a child Node writer process, records a hash-only partial remote
state with 2 of 8 planned targets observed, copies those rows into a SQLite
`recovery_journal` table with schema version 1, closes the database, and lets
the writer process exit. The parent process reopens the SQLite file, reads it
with `readSqliteRecoveryJournalTable()`, verifies monotonic rows and a
restart-readable committed-state envelope, and confirms inspection reports
`blocked-recovery` with 2 new targets, 6 old targets, and 0 blocked-unknown
targets without retaining raw fixture payloads.

## Validation run

```bash
node --test test/rpp-0612-blocked-recovery-classification.test.js
node --test --test-name-pattern 'RPP-0612 SQLite-backed blocked recovery rows survive process restart' test/recovery-journal.test.js
node --test --test-name-pattern 'blocked recovery classification survives process restart' test/recovery-journal.test.js
node --test --test-name-pattern '(restart inspection|blocked recovery classification survives process restart|state survives restart)' test/recovery-journal.test.js
node --test test/recovery-journal.test.js test/recovery-repair.test.js
npm run test:recovery:file-journal
node --test test/checklist-completion-lint.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence
git diff --check
```

Observed result: focused RPP-0612 coverage exited 0 with 1 subtest. The
recovery journal and repair regressions exited 0 with 33 subtests, the file
journal restart smoke exited 0, and the checklist lint, evidence redaction scan,
and whitespace check all exited 0. Salvage validation for the supplemental
recovery-journal regression exited 0 with the SQLite RPP-0612 subtest, 1
file-backed focused subtest, 9 adjacent restart/classification subtests, and the
full recovery journal suite at 29 subtests.

## Residual scope

This evidence is limited to file-backed and SQLite recovery journal restart
readback plus blocked partial-remote classification. It does not extend
generated harness coverage, production route authentication, plugin-driver
behavior, topology proofs, release verifier carry-through, or public progress
reporting.
