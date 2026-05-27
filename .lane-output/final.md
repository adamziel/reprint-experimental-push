2026-05-27 05:21:12 CEST (+0200)

Changed files:
- [src/recovery-journal.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/durable-journal-code/src/recovery-journal.js)
- [scripts/recovery/file-journal-restart-smoke.mjs](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/durable-journal-code/scripts/recovery/file-journal-restart-smoke.mjs)
- [test/recovery-journal.test.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/durable-journal-code/test/recovery-journal.test.js)
- [.lane-output/final.md](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/durable-journal-code/.lane-output/final.md)

I kept this pass inside the durable-journal lane and tightened the production recovery-journal contract instead of adding another parity-only note. [src/recovery-journal.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/durable-journal-code/src/recovery-journal.js) now requires non-empty `artifactRefs` for `openProductionRecoveryJournal()` and `consumeProductionRecoveryJournal()`, and the shared `productionRecoveryJournalInspectionSurfaceIsPresent()` helper now fails closed when the inspected journal omits restart artifact references. [scripts/recovery/file-journal-restart-smoke.mjs](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/durable-journal-code/scripts/recovery/file-journal-restart-smoke.mjs) now supplies explicit per-scenario artifact refs so the local production wrapper still exercises the stricter contract. [test/recovery-journal.test.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/durable-journal-code/test/recovery-journal.test.js) now proves the inspection surface exposes `artifactRefs`, rejects missing artifact refs, and keeps the lease-fence divergence checks fail-closed.

Commands run:
```bash
git status --short --branch
date '+%Y-%m-%d %H:%M:%S %Z (%z)'
node --check src/recovery-journal.js
node --check scripts/recovery/file-journal-restart-smoke.mjs
node --check test/recovery-journal.test.js
timeout 120s node --test --test-name-pattern='production recovery journal' test/recovery-journal.test.js
git diff --check -- src/recovery-journal.js scripts/recovery/file-journal-restart-smoke.mjs test/recovery-journal.test.js
```

Push result:
- Pending commit/push from this lane worktree.

Worktree status:
- Dirty in the lane-owned files above plus this handoff file.

Next supervisor nudge:
- Reliable should keep using the shared recovery helper path and stop treating artifact refs as optional release-verifier decoration. If the checked release path still carries a private journal proof copy, the next reliable-owned step is to consume the stricter shared helper from [src/recovery-journal.js](/home/claude/reprint-experimental-push-lanes/reorg-20260526-code/durable-journal-code/src/recovery-journal.js) so missing restart artifacts fail the release boundary instead of passing as partial journal evidence.
