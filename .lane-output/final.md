No Data Loss Recovery handoff:

- Timestamp: 2026-05-26 16:14:09 CEST (+0200)
- Production recovery journals now fail closed if a restarted consumer or reopened writer tries to drop a persisted owned remote-artifact path.
- This closes a recovery-owned gap where `consumeProductionRecoveryJournal(...)` could previously reopen a journal that had persisted `artifactRefs.remote` and silently report `remote: null` / `ownsRemoteArtifact: false` instead of rejecting the restart.
- Added focused regression coverage for both reopen and consume paths in the recovery-journal test slice.

Changed files:

- [`src/recovery-journal.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/src/recovery-journal.js)
- [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/test/recovery-journal.test.js)
- [`.lane-output/final.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/no-data-loss-recovery/.lane-output/final.md)

Commands:

- `date '+%Y-%m-%d %H:%M:%S %Z (%z)'`
- `node --input-type=module <<'EOF' ... EOF`
- `timeout 60s node --test test/recovery-journal.test.js`
- `git diff --check -- src/recovery-journal.js test/recovery-journal.test.js`

Push result:

- Pending commit/push.

Worktree status:

- Branch: `lane/no-data-loss-recovery-work`
- Dirty tracked files: `src/recovery-journal.js`, `test/recovery-journal.test.js`, `.lane-output/final.md`

Next supervisor nudge:

1. Reliable can keep treating the recovery adapter as required to preserve owned remote-artifact evidence across restart; if the checked release path reopens the journal without the persisted remote artifact path, it should now fail closed immediately instead of silently downgrading ownership.
