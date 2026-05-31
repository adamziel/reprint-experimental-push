# RPP-0691 new remote recovery classification release verifier variant 5 evidence

Date: 2026-05-31
Issue: RPP-0691
Lane: recovery

## Scope

This is focused local recovery-journal regression coverage. It proves
SQLite-backed restart readback for the new-remote recovery classification, then
carries that classification through the release-verifier recovery gate helper.
It does not prove a live production-backed durable journal boundary, does not
change release status, and keeps final release NO-GO.

## Proof added

- Added standalone coverage in
  `test/rpp-0691-new-remote-recovery-classification-v5.test.js`.
- The test builds deterministic five-target and seven-target generated plans
  with preserved remote-only resources outside the mutation and precondition
  sets.
- Each generated case opens a production-shaped recovery journal, advances an
  expired retry claim on the same checked path, records one
  `mutation-observed` row per planned target, appends `journal-completed`, and
  verifies the file-backed rows are sequential, fsynced, restart-readable, and
  hash-only.
- The same hash-only rows are mirrored into a local SQLite `recovery_journal`
  table, the database is closed and reopened, and
  `readSqliteRecoveryJournalTable()` proves completed restart state.
- Restart inspection over SQLite proves `fully-updated-remote`,
  `remoteClassification.state === "new-remote"`,
  `remoteRecoveryClassification.kind === "new-remote"`, SQLite storage,
  restart-readable completed state, and all planned targets in the `new`
  bucket.
- The completed journal inspected against the unchanged remote reports
  `old-remote`; a target drifted outside the before/after hash envelope reports
  `blocked-recovery`. Those adjacent classifications let the
  release-verifier-shaped proof satisfy old, new, and blocked recovery states
  without treating a completed row alone as sufficient evidence.
- `buildDurableRecoveryJournalReleaseProof()` receives the SQLite-backed
  new-remote inspection on the same checked recovery path and reports
  `gate: "GATE-2"`, `durableRecoveryJournalBoundary: "release-verifier"`,
  `checks.newState: true`, `checks.recoveryInspectAfterRestart: true`, and
  `partialStates.new.proved: true`.
- Missing, malformed, stale, and drifted new-remote classification evidence
  keep the release proof at `ok: false` with `checks.newState: false`.

## Redaction

Journal rows are checked with `assertJournalRecordHasNoRawValues()`. The test
also scans file-backed rows, SQLite readback, restart inspections, release
summaries, release proofs, and support envelopes for deterministic fixture
payloads. The support evidence carries hashes, counts, state names, row hashes,
checked-path hashes, storage metadata, and support-only release movement
markers.

## Validation run

```bash
node --check test/rpp-0691-new-remote-recovery-classification-v5.test.js
node --test --test-name-pattern RPP-0691 test/rpp-0691-new-remote-recovery-classification-v5.test.js
node --test --test-name-pattern RPP-0671 test/rpp-0671-new-remote-recovery-classification-v4.test.js
node --test --test-name-pattern RPP-0651 test/rpp-0651-new-remote-recovery-classification-v3.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0691-new-remote-recovery-classification-v5.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0691 release-verifier new-remote proof passed 2 subtests, 0
  failures.
- Predecessor RPP-0671 new-remote classification proof passed locally.
- Predecessor RPP-0651 new-remote classification proof passed locally.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This evidence is local recovery support only. Final release remains NO-GO until
live production-backed durable journal and release-boundary evidence is checked.

Integration recommendation: keep this as support-only journal recovery evidence
and require production-backed durable journal evidence before release movement.
