# RPP-0617 process kill before first mutation evidence

Date: 2026-05-30
Issue: RPP-0617
Lane: journal-recovery

## Proof added

- Added a lab-only, default-off `labDelayAfterDbJournalStartedMs` hook to the
  Playground REST apply path. The delay runs immediately after the DB
  `apply-started` row is appended and before live revalidation or any mutation
  callback can run.
- Added `test/rpp-0617-process-kill-before-first-mutation.test.js`, a focused
  `node:test` crash-safety proof that starts a local-only Playground server,
  opens a DB-journaled apply, waits for durable `idempotency-opened` and
  `apply-started` rows, and then sends `SIGKILL` to the Playground process group
  before the first mutation event appears.
- The test restarts the same host-mounted WordPress directory, reads the DB
  journal again, and verifies the original row sequences, request hash, planned
  mutation evidence, recovery targets, and verified precondition hash evidence
  are still present.
- The restarted target snapshot remains all old: 4 old / 0 new / 0
  blocked-unknown targets. A DB-only recovery classification built from the
  restarted `apply-started` row plus live target hashes reports `old-remote` and
  does not use the legacy option journal.
- The hook is bounded by the existing lab delay validator and is inert unless a
  test payload supplies the explicit delay key.

## Focused regression

`test/rpp-0617-process-kill-before-first-mutation.test.js` covers the hard-kill
window before the first mutation:

1. Builds a ready file-create plan with four mutations and verifies dry-run
   preconditions.
2. Starts `/apply` with `labDelayAfterDbJournalStartedMs`, then polls the DB
   journal until `apply-started` is visible.
3. Asserts no `mutation-prepared`, `mutation-storage-write-ready`,
   `mutation-applied`, terminal, replay, or stale-claim rows exist before the
   kill.
4. Sends `SIGKILL` to the local Playground process group and confirms the
   in-flight apply did not return success.
5. Restarts the same WordPress mount, proves the pre-kill DB row sequences are
   readable after restart, and proves every planned target is still at its old
   hash.

## Validation run

```bash
node --check test/rpp-0617-process-kill-before-first-mutation.test.js
php -l scripts/playground/push-remote-rest-plugin.php
node --test test/rpp-0617-process-kill-before-first-mutation.test.js
node --test test/recovery-journal.test.js
npm run test:recovery:file-journal
```

Observed result: JS syntax check returned 0, PHP lint reported no syntax errors,
the focused RPP-0617 test reported 1 pass / 0 fail, the recovery-journal
regression slice reported 28 pass / 0 fail, and the file-journal restart smoke
returned 0 with fail-before-mutation classified as `old-remote`.
