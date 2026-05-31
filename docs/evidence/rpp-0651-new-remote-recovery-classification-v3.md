# RPP-0651 new remote recovery classification variant 3

Date: 2026-05-31
Issue: RPP-0651
Lane: recovery

## Scope

This is generated local recovery support coverage. It proves SQLite-backed
readback for the new-remote recovery classification inside the sandbox. It does
not prove a live production-backed durable journal boundary, does not change
release status, and keeps final release NO-GO.

## Proof Added

- Added standalone generated coverage in
  `test/rpp-0651-new-remote-recovery-classification-v3.test.js`.
- The test builds deterministic three-target and five-target generated plans
  with preserved remote-only resources outside the mutation and precondition
  sets.
- Each generated case writes a production-shaped completed recovery journal,
  records one `mutation-observed` row per planned target, appends
  `journal-completed`, mirrors the hash-only rows into a local SQLite
  `recovery_journal` table, closes and reopens SQLite, and reads back through
  `readSqliteRecoveryJournalTable()`.
- Restart inspection over the SQLite journal proves `fully-updated-remote`,
  `remoteClassification.state === "new-remote"`,
  `remoteRecoveryClassification.kind === "new-remote"`, SQLite storage,
  restart-readable completed state, and all planned targets in the `new`
  bucket.
- The same journal inspected against the unchanged remote reports `old-remote`,
  and a target outside the before/after hash envelope reports
  `blocked-recovery`, keeping the new-remote result tied to current target
  hashes.
- Proof-movement support evidence is accepted only when the classification
  envelope is fresh, hash-only, SQLite-backed, all-new, and bound to the same
  journal-row hash. Missing, malformed, expired, superseded-plan, and
  journal-drifted envelopes are rejected before movement.

## Redaction

Journal rows are checked with `assertJournalRecordHasNoRawValues()` and the
test scans generated evidence objects for deterministic fixture payloads. The
support evidence carries only hashes, counts, row hashes, classification
metadata, storage metadata, and support-only scope markers.

## Validation Run

```bash
node --check test/rpp-0651-new-remote-recovery-classification-v3.test.js
node --test --test-name-pattern RPP-0651 test/rpp-0651-new-remote-recovery-classification-v3.test.js
node --test --test-name-pattern RPP-0611 test/rpp-0611-new-remote-recovery-classification.test.js
node --test --test-name-pattern RPP-0612 test/rpp-0612-blocked-recovery-classification.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0651-new-remote-recovery-classification-v3.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0651 test passed 2 subtests, 0 failures.
- Adjacent RPP-0611 new-remote classification test passed locally.
- Adjacent RPP-0612 blocked classification test passed locally.
- Scoped artifact redaction scan was clean.
- Both whitespace diff checks were clean.

## Release Posture

This evidence is local recovery support only. Final release remains NO-GO until
live production-backed durable journal and release-boundary evidence is checked.
