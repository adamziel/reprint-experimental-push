# RPP-0679 missing commit finalization, variant 4

Date: 2026-05-31
Issue: RPP-0679
Lane: recovery

## Scope

This is generated local recovery-journal coverage only. It proves the
file-backed, production-shaped journal can recover from a writer that durably
records every `mutation-observed` row but exits before the terminal
`journal-completed` row. It does not prove live production-backed durability
and keeps final release posture NO-GO.

## Proof added

- Added standalone generated coverage in
  `test/rpp-0679-missing-commit-finalization-v4.test.js`.
- The test creates multiple generated plans, opens a claim-fenced
  production-shaped file-backed recovery journal, and injects failure after the
  final planned mutation is durably observed but before completion is written.
- Parent restart readback verifies the journal integrity is OK, all mutation
  rows are restart-readable, no `journal-completed` row exists, and the
  committed target envelope is fully hash-accounted but not finalized.
- Before finalization, restart inspection still classifies the target as
  `fully-updated-remote`, and the audit evidence exposes lease owner identity
  from the latest `mutation-observed` row: `claimId`, `claimHash`,
  `claimKeyHash`, sequence, event type, a visible identity flag, and a hash of
  the lease owner block.
- The same claim reopens the journal, appends only the missing
  `journal-completed` row, and verifies the original mutation row sequences are
  unchanged.
- After finalization, restart readback reports `committedState.status:
  "completed"`, `targetEnvelope.allTargetsCommitted: true`, and visible lease
  owner identity from the `journal-completed` audit row. The writer lease and
  lease fence identities match the finalized lease owner claim hash/key hash.

## Redaction

All generated journal rows and audit evidence summaries are checked with
`assertJournalRecordHasNoRawValues()` plus deterministic fixture payload scans.
The exposed evidence is hash-only: target hashes, journal row hashes, claim
hashes, and lease owner hashes are retained, while raw site payloads, secrets,
bearer tokens, credentials, and live endpoint output are excluded.

## Validation run

```bash
node --check test/rpp-0679-missing-commit-finalization-v4.test.js
node --test --test-name-pattern RPP-0679 test/rpp-0679-missing-commit-finalization-v4.test.js
node --test --test-name-pattern RPP-0659 test/rpp-0659-missing-commit-finalization-v3.test.js
node --test --test-name-pattern RPP-0639 test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0679-missing-commit-finalization-v4.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0679 test passed 1 subtest, 0 failures.
- Predecessor RPP-0659 generated missing-finalization proof passed 1 subtest,
  0 failures.
- Prior RPP-0639 missing-finalization proof passed 1 subtest, 0 failures.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This evidence is local recovery support for generated missing-completion
finalization coverage. It does not replace live production-backed durable
journal evidence at the release boundary.
