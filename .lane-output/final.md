No Data Loss Recovery handoff:

- Timestamp: 2026-05-27 07:07:04 CEST (+0200)
- Branch head at handoff: `983d99aed78c432885646cbcf9ffe660c1b3ccb1`

What changed:

- Tightened the shared checked durable-journal matcher in [src/recovery-journal.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/recovery-journal.js) so `checkedDurableJournalBoundarySatisfied()` now requires an explicit `ownership.supportedSurface === 'production-recovery-journal-adapter'` marker before the checked boundary can stay green.
- Surfaced that same checked adapter marker from `productionRecoverySupportReport()` in [src/apply.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/apply.js), so downstream release-path consumers see the supported surface on the checked-boundary proof instead of inferring it indirectly from missing-dependency state.
- Added focused regression coverage in [test/recovery-journal.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/recovery-journal.test.js) and [test/push-planner.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/push-planner.test.js) covering the satisfied packaged/live checked contracts and the missing supported-surface drift path.

Changed files:

- [src/apply.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/apply.js)
- [src/recovery-journal.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/recovery-journal.js)
- [test/push-planner.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/push-planner.test.js)
- [test/recovery-journal.test.js](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/recovery-journal.test.js)
- [.lane-output/final.md](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/.lane-output/final.md)

Commands:

- `timeout 60s node --test --test-name-pattern "checked durable journal boundary accepts the packaged production journal scope|checked durable journal boundary accepts the explicit packaged recovery journal scope|checked durable journal boundary accepts the explicit live recovery journal scope" test/recovery-journal.test.js`
- `timeout 60s node --test --test-name-pattern "surfaces a satisfied checked durable-journal boundary when the inspected lease fence matches the packaged production contract|keeps checked boundary closed when production adapter markers drift from the surfaced checked contract" test/push-planner.test.js`
- `git diff --check -- src/apply.js src/recovery-journal.js test/recovery-journal.test.js test/push-planner.test.js`

Push result:

- Pending in this handoff; commit/push is the next lane action.

Worktree status:

- Dirty tracked files: `.lane-output/final.md`, `src/apply.js`, `src/recovery-journal.js`, `test/push-planner.test.js`, `test/recovery-journal.test.js`

Next supervisor nudge:

- Reliable and durable-journal consumers can now require the explicit checked `supportedSurface` marker instead of accepting a claim/lease-clean boundary proof that omits the adapter surface.
- The next recovery-owned patch should only happen if reliable still exposes a restart-readable production-journal consumer gap after this checked-surface guard lands.
