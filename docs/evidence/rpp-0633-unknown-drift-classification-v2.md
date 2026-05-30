# RPP-0633 unknown drift classification, variant 2

Date: 2026-05-30
Issue: RPP-0633
Lane: recovery

## Proof added

- Added a focused recovery journal regression for the variant 2 unknown-drift
  classification path.
- The test opens a claim-fenced production JSONL recovery journal, persists the
  planned target envelope, then changes one planned remote target to a hash that
  matches neither the journaled before hash nor the journaled after hash.
- Restart inspection classifies the state as `blocked-recovery` with counts
  `{ old: 7, new: 0, blockedUnknown: 1 }` and marks the drifted target as
  `blocked-unknown` with before, after, and observed hashes only.
- Recovery repair inspection carries that target as
  `TARGET_DRIFTED_OUTSIDE_ENVELOPE`, reports
  `blocked-operator-decision-required`, and sets `requiresOperatorDecision`.
- Replay retry without an explicit operator decision throws
  `RECOVERY_REPAIR_OPERATOR_DECISION_REQUIRED` before mutating the current
  remote. The test verifies the remote snapshot digest is unchanged, the
  drifted remote value is preserved, and another old planned target remains old.
- The persisted JSONL journal is checked for the local and drift sentinel
  strings; neither raw value is present.

## Validation run

```bash
umask 0022 && node --test --test-name-pattern 'RPP-0633' test/recovery-journal.test.js
umask 0022 && node --test --test-name-pattern 'old remote|fail-after-2|completed replay|drifts outside|RPP-0633' test/recovery-journal.test.js
umask 0022 && node --test test/recovery-journal.test.js
umask 0022 && npm run test:recovery:file-journal
```

Observed result: the focused RPP-0633 test exited 0 with 1 pass. The adjacent
classification subset exited 0 with 5 pass / 0 fail. The full recovery journal
suite exited 0 with 29 pass / 0 fail. The file-journal restart smoke exited 0
and reported its drift scenario as `blocked-recovery` with one
`blockedUnknown` target.

## Residual scope

This evidence is limited to recovery journal classification and repair retry
behavior for unknown drift. It does not touch generated harness coverage,
plugin-driver behavior, executor-auth replay, storage benchmarks, progress
publishing, or supervisor reports.
