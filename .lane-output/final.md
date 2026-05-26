No Data Loss Recovery handoff:

- Timestamp: 2026-05-26 16:42:22 CEST (+0200)
- Persisted production recovery ownership now also fails closed if a later restart-readable record explicitly clears `artifactRefs.journal`.
- This closes the symmetric corruption gap for the owned journal artifact path: later `journal: null` records can no longer silently degrade restart-readable production journal ownership during reopen or release-path consumption.
- Added focused reopen and consume regressions proving that explicit journal-artifact clearing is rejected just like explicit remote-artifact clearing.

Changed files:

- [`src/recovery-journal.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/recovery-journal.js)
- [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/recovery-journal.test.js)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/.lane-output/final.md)

Commands:

- `git status --short --branch`
- `sed -n '1,220p' AGENTS.md`
- `sed -n '1,220p' supervision/README.md`
- `sed -n '1,220p' supervision/lanes/no-data-loss-recovery.md`
- targeted `grep`/`sed` reads across `src/recovery-journal.js` and `test/recovery-journal.test.js`
- `timeout 60s node --test --test-name-pattern "production recovery journal reopen fails closed when a later persisted record explicitly clears the owned remote artifact ref|production recovery journal consumption fails closed when a later persisted record explicitly clears the owned remote artifact ref|production recovery journal reopen fails closed when a later persisted record explicitly clears the owned journal artifact ref|production recovery journal consumption fails closed when a later persisted record explicitly clears the owned journal artifact ref" test/recovery-journal.test.js`
- `git diff --check -- src/recovery-journal.js test/recovery-journal.test.js`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`

Push result:

- Pending commit/push.

Worktree status:

- Branch: `lane/no-data-loss-recovery-work`
- Dirty tracked files: `src/recovery-journal.js`, `test/recovery-journal.test.js`, `.lane-output/final.md`

Next supervisor nudge:

1. `main:reliable-exec` can now treat explicit persisted clearing of either owned recovery artifact path as hard production-journal corruption; later restart-readable records cannot null out `artifactRefs.journal` or `artifactRefs.remote` and still be reopened or consumed on the checked release path.
