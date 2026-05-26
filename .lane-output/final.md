No Data Loss Recovery handoff:

- Timestamp: 2026-05-26 16:40:11 CEST (+0200)
- Persisted production recovery ownership now fails closed if a later restart-readable record explicitly clears `artifactRefs.remote` instead of silently falling back to an older owned remote artifact path.
- This closes a corruption gap at the release-path consume/reopen boundary: a later persisted `remote: null` can no longer weaken remote-artifact ownership for fenced production recovery journals.
- Added focused reopen and consume regressions proving that explicit remote-artifact clearing stays blocked even when the caller still passes the previously owned remote artifact path.

Changed files:

- [`src/recovery-journal.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/recovery-journal.js)
- [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/recovery-journal.test.js)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/.lane-output/final.md)

Commands:

- `git status --short --branch`
- `sed -n '1,220p' AGENTS.md`
- `sed -n '1,220p' supervision/README.md`
- `sed -n '1,220p' supervision/lanes/no-data-loss-recovery.md`
- targeted `grep`/`sed` reads across `src/apply.js`, `src/recovery-journal.js`, `test/push-planner.test.js`, and `test/recovery-journal.test.js`
- `timeout 60s node --test --test-name-pattern "production recovery journal reopen fails closed when a later persisted record explicitly clears the owned remote artifact ref|production recovery journal consumption fails closed when a later persisted record explicitly clears the owned remote artifact ref|production recovery journal reopen fails closed when a later persisted record drops owned remote artifact refs|production recovery journal consumption fails closed when a later persisted record drops owned remote artifact refs" test/recovery-journal.test.js`
- `git diff --check -- src/recovery-journal.js test/recovery-journal.test.js`
- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`

Push result:

- Pending commit/push.

Worktree status:

- Branch: `lane/no-data-loss-recovery-work`
- Dirty tracked files: `src/recovery-journal.js`, `test/recovery-journal.test.js`, `.lane-output/final.md`

Next supervisor nudge:

1. `main:reliable-exec` can treat explicit persisted remote-artifact clearing as a hard recovery-journal corruption signal; reopen and release-path consumption now fail closed instead of reviving the last good owned remote artifact path.
