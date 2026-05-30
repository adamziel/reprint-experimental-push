# RPP-0628 restart-readable staged state, variant 2

Date: 2026-05-30
Issue: RPP-0628
Lane: recovery
Checklist item: RPP-0628 - Prove restart-readable staged state, variant 2.

## Proof added

- `test/recovery-journal.test.js` now includes
  `RPP-0628 production recovery journal staged state remains restart-readable after process restart retry`.
- The proof reuses the RPP-0608 staged-state readback surface and the RPP-0627
  production-wrapper retry pattern: a claim-fenced production journal writes the
  target envelope, stages through `applyPlan()`, stops at the injected
  `failAfterStaging` boundary, and is read back from the parent process.
- Parent readback verifies integrity `ok`, monotonic sequences, row-level fsync
  evidence, one ownership row, one active claim row, no duplicate
  `target-planned` envelope, hash-only staged snapshot evidence, and
  `stagedState.restartReadable: true`.
- A restarted same-claim production retry reopens the journal, appends
  `journal-retry-opened`, and emits the production inspection surface. The test
  verifies that surface matches the persisted `openState` and `stagedState`
  exactly.
- Recovery inspection and repair replay prove the retry applies only the
  planned old target while preserving remote-only changes present before the
  plan and after the simulated crash. The journal text is checked for the
  staged and preserved raw fixture strings and does not contain them.

## Validation run

```bash
node --test --test-name-pattern 'RPP-0628' test/recovery-journal.test.js
node --test --test-name-pattern 'open state survives|RPP-0627|staged state survives|RPP-0628|committed state survives' test/recovery-journal.test.js
node --test test/recovery-journal.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0628-restart-readable-staged-state-v2.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: focused RPP-0628 validation exited 0 with 1 pass / 0 fail,
the adjacent restart-readable recovery group exited 0 with 4 pass / 0 fail, and
the full recovery journal suite exited 0 with 29 pass / 0 fail. Checklist lint,
scoped Markdown redaction scan, and diff whitespace checks are recorded in the
session validation output.

## Residual scope

This evidence is limited to production-wrapper recovery journal staged-state
readback after process restart, same-claim retry inspection, and recovery repair
preservation of remote-only changes. Open-state implementation, committed-state
proof, storage benchmarks, generated harness coverage, plugin-driver coverage,
executor-auth replay, topology, release operations, and public progress
publishing remain outside this slice.
