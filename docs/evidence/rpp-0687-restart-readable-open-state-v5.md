# RPP-0687 restart-readable open state release verifier variant 5 evidence

Date: 2026-05-31
Issue: RPP-0687
Lane: journal-recovery

## Scope

This is focused local recovery-journal regression coverage. It proves
claim-fenced open-state journal rows are durable after a process boundary and
that the restarted open-state readback is carried through the local
release-verifier-shaped durable recovery gate helper. Final release status
remains NO-GO until equivalent production-owned durable storage and live
release-boundary evidence are checked outside the sandbox.

## Proof added

- Added standalone coverage in
  `test/rpp-0687-restart-readable-open-state-v5.test.js`.
- A child Node process opens a production-shaped recovery journal claim on a
  sandbox JSONL path, emits the writer inspection surface, and exits without an
  explicit close. A fresh Node process then reads the journal back from disk.
- First restart readback proves the durable `journal-opened` row,
  `journal-ownership-recorded` row, `target-planned` rows, and
  `recovery-claim-opened` row are present with monotonic sequences,
  row-level fsync markers, and `openState.restartReadable: true`.
- A second child process advances an expired retry claim on the same checked
  recovery path. Fresh-process readback proves the first row set is preserved,
  the retry appends `stale-claim-advanced`, `journal-retry-opened`, and a retry
  ownership row, and the latest open state remains restart-readable with
  `latestOpenType: journal-retry-opened`.
- The restarted `old-remote` inspection is attached to the same checked
  recovery path and consumed by `buildDurableRecoveryJournalReleaseProof()`.
  The helper reports `gate: GATE-2`,
  `durableRecoveryJournalBoundary: release-verifier`, `gateStatus: proven`,
  `sameReleaseBoundary: true`, `checks.restartReadable: true`,
  `checks.recoveryInspectAfterRestart: true`, and `checks.oldState: true`.
- The release summary carries an explicit `openStateReadback` object with the
  checked path, durable row count, open row count, latest open row sequence,
  latest open row type, and hash-only row digest.
- Persisted rows, writer inspections, restart inspections, release summaries,
  release proof evidence, and the raw JSONL file are scanned for deterministic
  fixture payloads. Every persisted row also satisfies
  `assertJournalRecordHasNoRawValues()`.

## Validation run

```bash
node --check test/rpp-0687-restart-readable-open-state-v5.test.js
node --test --test-name-pattern RPP-0687 test/rpp-0687-restart-readable-open-state-v5.test.js
node --test --test-name-pattern RPP-0667 test/rpp-0667-restart-readable-open-state-v4.test.js
node --test --test-name-pattern RPP-0647 test/rpp-0647-restart-readable-open-state-v3.test.js
node --test --test-name-pattern RPP-0627 test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0687-restart-readable-open-state-v5.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0687 release-verifier open-state proof passed 1 subtest, 0
  failures.
- Adjacent RPP-0667 variant-4 open-state proof passed 1 subtest, 0 failures.
- Adjacent RPP-0647 variant-3 open-state proof passed 3 subtests, 0 failures.
  Node emitted the expected experimental `node:sqlite` warning for the SQLite
  mirror subtest.
- RPP-0627 recovery-journal open-state retry proof passed 1 selected subtest,
  0 failures. Node emitted the expected experimental `node:sqlite` warning
  while loading the broader recovery-journal suite.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This is local support evidence only. It does not change release status, does
not claim production-backed release readiness, and keeps final release NO-GO.
