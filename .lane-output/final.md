No Data Loss Recovery handoff:

- Timestamp: 2026-05-26 15:19:32 CEST (+0200)
- The recovery-artifact envelope tests now distinguish artifact-shape failures from envelope-shape failures:
  - symbol-keyed artifact metadata remains a `RECOVERY_STATE_INVALID` envelope failure;
  - blocked recovery states that reuse the same journal and remote artifact object now expect `RECOVERY_ARTIFACTS_INVALID`.
- I verified the relevant implementation behavior directly with a small Node snippet, so I did not change `src/apply.js`.

Changed files:

- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/push-planner.test.js)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/.lane-output/final.md)

Commands:

- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`
- `git diff -- test/push-planner.test.js`
- `node --input-type=module` snippets against `assertRecoveryStateEnvelope(...)`
- `git diff --check -- test/push-planner.test.js`

Push result:

- Not pushed yet.

Worktree status:

- Branch: `lane/no-data-loss-recovery-work`
- Dirty tracked files: `test/push-planner.test.js`, `.lane-output/final.md`

Next supervisor nudge:

1. Commit the recovery-artifact expectation correction, then push the lane branch and let audit classify whether this is still support-level recovery evidence or the smallest acceptable recovery-boundary tightening.
