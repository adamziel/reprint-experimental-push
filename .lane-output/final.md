Reconciled this lane against `origin/lane/no-data-loss-recovery` and kept the recovery proof intact.

Changed files:
- `docs/recovery/acceptable-post-failure-states.md`
- `docs/recovery/acceptable-states.md`
- `docs/recovery/accepted-post-failure-states.md`
- `docs/recovery/atomic-apply-recovery-states.md`
- `docs/recovery/atomic-apply-recovery.md`
- `docs/recovery/contract.md`
- `docs/recovery/durable-apply-journal-replay.md`
- `docs/recovery/durable-apply-post-failure-contract.md`
- `docs/recovery/durable-apply-recovery.md`
- `docs/recovery/durable-apply-release-blockers.md`
- `docs/recovery/durable-journal-acceptable-post-failure-states.md`
- `docs/recovery/durable-journal-acceptance-note.md`
- `docs/recovery/durable-journal-boundaries.md`
- `docs/recovery/durable-journal-boundary-matrix.md`
- `docs/recovery/durable-journal-contract.md`
- `docs/recovery/durable-journal-executable-boundary.md`
- `docs/recovery/durable-journal-executable-gap.md`
- `docs/recovery/durable-journal-no-data-loss-bridge.md`
- `docs/recovery/durable-journal-notes.md`
- `docs/recovery/durable-journal-production-boundary.md`
- `docs/recovery/durable-journal-production-evidence.md`
- `docs/recovery/durable-journal-production-gate.md`
- `docs/recovery/durable-journal-production-notes.md`
- `docs/recovery/durable-journal-production-recovery-semantics.md`
- `docs/recovery/durable-journal-production-vs-lab-recovery.md`
- `docs/recovery/durable-journal-production-vs-lab.md`
- `docs/recovery/durable-journal-recovery-model.md`
- `docs/recovery/durable-journal-replay-boundary.md`
- `docs/recovery/durable-journal-requirements.md`
- `docs/recovery/durable-journal-states.md`
- `docs/recovery/durable-journal-storage-boundary.md`
- `docs/recovery/durable-journal-vs-lab-evidence.md`
- `docs/recovery/durable-journal-vs-lab-model.md`
- `docs/recovery/durable-no-data-loss-state-matrix.md`
- `docs/recovery/durable-recovery-artifact-contract.md`
- `docs/recovery/durable-recovery-boundary.md`
- `docs/recovery/durable-recovery-post-failure-matrix.md`
- `docs/recovery/durable-recovery-release-blocker.md`
- `docs/recovery/executable-durable-journal-boundary.md`
- `docs/recovery/no-data-loss-acceptable-post-failure-states.md`
- `docs/recovery/no-data-loss-acceptance.md`
- `docs/recovery/no-data-loss-accepted-post-failure-states.md`
- `docs/recovery/no-data-loss-atomic-apply-contract.md`
- `docs/recovery/no-data-loss-atomic-apply-durable-journal-contract.md`
- `docs/recovery/no-data-loss-atomic-apply-state-contract.md`
- `docs/recovery/no-data-loss-atomic-replay-state-contract.md`
- `docs/recovery/no-data-loss-boundary-matrix.md`
- `docs/recovery/no-data-loss-boundary.md`
- `docs/recovery/no-data-loss-contract.md`
- `docs/recovery/no-data-loss-durable-apply-contract.md`
- `docs/recovery/no-data-loss-durable-boundary-checklist.md`
- `docs/recovery/no-data-loss-durable-boundary.md`
- `docs/recovery/no-data-loss-durable-journal-boundaries.md`
- `docs/recovery/no-data-loss-durable-journal-contract.md`
- `docs/recovery/no-data-loss-durable-journal-production-boundaries.md`
- `docs/recovery/no-data-loss-durable-journal-recovery-inspect-boundary.md`
- `docs/recovery/no-data-loss-durable-journal-release-gate.md`
- `docs/recovery/no-data-loss-durable-journal-replay-boundary.md`
- `docs/recovery/no-data-loss-durable-journal-state-summary.md`
- `docs/recovery/no-data-loss-durable-post-failure-contract.md`
- `docs/recovery/no-data-loss-durable-post-failure-state-contract.md`
- `docs/recovery/no-data-loss-durable-post-failure-states.md`
- `docs/recovery/no-data-loss-durable-recovery-boundary-checklist.md`
- `docs/recovery/no-data-loss-durable-recovery-contract.md`
- `docs/recovery/no-data-loss-durable-recovery-notes.md`
- `docs/recovery/no-data-loss-durable-recovery-production-boundary.md`
- `docs/recovery/no-data-loss-durable-recovery-state-contract.md`
- `docs/recovery/no-data-loss-durable-recovery-state-summary.md`
- `docs/recovery/no-data-loss-durable-recovery-states.md`
- `docs/recovery/no-data-loss-executable-replay-boundary.md`
- `docs/recovery/no-data-loss-journal.md`
- `docs/recovery/no-data-loss-post-failure-boundaries.md`
- `docs/recovery/no-data-loss-post-failure-contract.md`
- `docs/recovery/no-data-loss-post-failure-state-contract.md`
- `docs/recovery/no-data-loss-post-failure-states.md`
- `docs/recovery/no-data-loss-production-durable-journal-checklist.md`
- `docs/recovery/no-data-loss-production-durable-journal-contract.md`
- `docs/recovery/no-data-loss-production-durable-journal-note.md`
- `docs/recovery/no-data-loss-production-journal-notes.md`
- `docs/recovery/no-data-loss-recovery-artifact-contract.md`
- `docs/recovery/no-data-loss-recovery-boundaries.md`
- `docs/recovery/no-data-loss-recovery-boundary-checklist.md`
- `docs/recovery/no-data-loss-recovery-boundary-notes.md`
- `docs/recovery/no-data-loss-recovery-boundary-summary.md`
- `docs/recovery/no-data-loss-recovery-contract.md`
- `docs/recovery/no-data-loss-recovery-executable-boundary.md`
- `docs/recovery/no-data-loss-recovery-state-contract.md`
- `docs/recovery/no-data-loss-recovery-states.md`
- `docs/recovery/no-data-loss-recovery.md`
- `docs/recovery/no-data-loss-release-blocker.md`
- `docs/recovery/no-data-loss-state-contract.md`
- `docs/recovery/no-data-loss.md`
- `docs/recovery/post-failure-contract.md`
- `docs/recovery/post-failure-states.md`
- `docs/recovery/recovery-boundary-matrix.md`
- `docs/recovery/recovery-state-contract.md`
- `docs/recovery/recovery-state-matrix.md`
- `docs/recovery/release-boundary.md`
- `progress.html`
- `src/apply.js`
- `test/push-planner.test.js`

Commands:
- `git fetch origin lane/no-data-loss-recovery`
- `git merge --no-ff --no-edit origin/lane/no-data-loss-recovery`
- `node --test test/push-planner.test.js -t "failure before mutation" -t "failure after staging" -t "failure after dependency validation" -t "replaying a completed plan" -t "blocked partial remote recovery"`

Push result:
- Not pushed yet; merge commit still needs to be created first.

Worktree status:
- Merge in progress before commit
- Recovery tests passed: `421/421`

Next supervisor nudge:
1. Let me finish the merge commit, then push this reconciled lane tip to `origin/lane/no-data-loss-recovery`.
