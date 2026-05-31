# RPP-0653 unknown drift classification, variant 3

Date: 2026-05-31
Issue: RPP-0653
Lane: recovery

## Proof added

- Added generated local coverage for the unknown-drift recovery classification
  path in `test/rpp-0653-unknown-drift-classification-v3.test.js`.
- The regression builds a deterministic five-target plan with one unplanned
  remote-preserved file, opens a claim-fenced production JSONL recovery journal,
  advances an expired retry claim, and reads back the same journal path.
- Restart inspection over the retry snapshot reports `blocked-recovery`,
  `reasonCode: BLOCKED_TARGET_UNKNOWN`, and counts
  `{ old: 4, new: 0, blockedUnknown: 1 }`.
- The drifted planned target is recorded only with before, after, and observed
  hashes. The retry repair path requires an operator decision and throws
  `RECOVERY_REPAIR_OPERATOR_DECISION_REQUIRED` before any write callback runs.
- The test verifies the retry snapshot digest is unchanged, the unplanned
  preserved remote file remains at its retry value, and hash-only evidence does
  not contain raw fixture payloads.
- A release-shaped local proof moves only validated unknown-drift evidence into
  the blocked-state recovery proof. Missing, malformed, stale, and drifted
  unknown-drift classification evidence are rejected before that movement, so
  `checks.blockedState` remains false and the proof cannot become `ok: true`.

## Hash-only fixture notes

- Persisted rows and proof summaries use deterministic hashes, claim hashes,
  resource keys, local artifact references, and the sandbox-local checked JSONL
  path only.
- Fixture payloads are asserted absent from the journal rows, restart
  inspection, retry refusal details, repair inspection, and release-shaped proof.
- No live endpoint, remote tunnel, bearer credential, or external network
  dependency is used.

## Validation run

```bash
node --check test/rpp-0653-unknown-drift-classification-v3.test.js
node --test --test-name-pattern RPP-0653 test/rpp-0653-unknown-drift-classification-v3.test.js
node --test --test-name-pattern RPP-0611 test/rpp-0611-new-remote-recovery-classification.test.js
node --test --test-name-pattern RPP-0612 test/rpp-0612-blocked-recovery-classification.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0653-unknown-drift-classification-v3.md
git diff --check
git diff --cached --check
```

Observed local result: all commands exited 0 in this worktree.

## Residual scope

This is local support evidence for generated unknown-drift recovery
classification coverage and release-shaped proof carry-through. It does not
claim final release readiness and does not cover live endpoints, plugin-driver
behavior, executor-auth replay, storage benchmarks, progress publishing, or
supervisor reports.
