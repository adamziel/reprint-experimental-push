# RPP-0671 new remote recovery classification variant 4

Date: 2026-05-31
Issue: RPP-0671
Lane: recovery

## Scope

This is focused local recovery support coverage. It proves SQLite-backed
readback for the new-remote recovery classification inside the sandbox. It does
not prove a live production-backed durable journal boundary, does not change
release status, and keeps final release NO-GO.

## Proof added

- Added standalone coverage in
  `test/rpp-0671-new-remote-recovery-classification-v4.test.js`.
- The test builds deterministic four-target and six-target generated plans with
  preserved remote-only resources outside the mutation and precondition sets.
- Each generated case writes a production-shaped completed recovery journal,
  records one `mutation-observed` row per planned target, appends
  `journal-completed`, mirrors the hash-only rows into a local SQLite
  `recovery_journal` table, closes and reopens SQLite, and reads back through
  `readSqliteRecoveryJournalTable()`.
- Restart inspection over the reopened SQLite journal proves
  `fully-updated-remote`, `remoteClassification.state === "new-remote"`,
  `remoteRecoveryClassification.kind === "new-remote"`, SQLite storage,
  restart-readable completed state, and all planned targets in the `new`
  bucket.
- The same journal inspected against the unchanged remote reports `old-remote`,
  keeping the new-remote result tied to current target hashes instead of only
  the `journal-completed` row.
- A target drifted outside the before/after hash envelope reports
  `blocked-recovery` with one blocked-unknown target, proving the variant fails
  closed when current remote state cannot be classified from the persisted
  journal.
- The local classification evidence summary is accepted only when it is
  hash-only, SQLite-backed, restart-readable, all-new, and bound to the same
  journal-row hash.

## Redaction

Journal rows are checked with `assertJournalRecordHasNoRawValues()` and the
test scans generated evidence objects for deterministic fixture payloads. The
support evidence carries only hashes, counts, row hashes, classification
metadata, storage metadata, and support-only scope markers.

## Validation run

```bash
node --check test/rpp-0671-new-remote-recovery-classification-v4.test.js
node --test --test-name-pattern RPP-0671 test/rpp-0671-new-remote-recovery-classification-v4.test.js
node --test --test-name-pattern RPP-0651 test/rpp-0651-new-remote-recovery-classification-v3.test.js
node --test --test-name-pattern 'new-remote|RPP-0631' test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0671-new-remote-recovery-classification-v4.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0671 test passed locally.
- Predecessor RPP-0651 new-remote classification proof passed locally.
- Adjacent recovery-journal new-remote and RPP-0631 coverage passed locally.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.

## Release posture

This evidence is local recovery support only. Final release remains NO-GO until
live production-backed durable journal and release-boundary evidence is checked.
