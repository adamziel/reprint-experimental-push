# RPP-0638 process-kill mid-mutation retry preservation evidence

Date: 2026-05-30
Issue: RPP-0638
Lane: recovery

## Proof added

- Added a focused file-backed recovery journal regression for a real `SIGKILL`
  during the mutation-commit loop, after a durable `mutation-observed` row has
  been fsynced for the second planned target and before `journal-completed` can
  be written.
- The restarted journal is re-read from disk and must report integrity `ok`, a
  restart-readable committed state, two committed mutation rows, and zero
  completion rows.
- The parent process resumes from a persisted remote snapshot with two planned
  targets already new, two planned targets still old, one remote-only change that
  existed before planning, and another remote-only change added after the kill.
- Recovery repair/retry must classify the state as `partial-remote-replayable`,
  roll forward only the old planned targets, skip the already-updated planned
  targets, and preserve both remote-only changes.
- The regression also checks that the JSONL journal does not contain the raw
  planned or preserved fixture values.

## Focused regression

`test/recovery-journal.test.js` now includes
`file-backed journal process kill mid mutation set retry preserves remote-only changes`:

1. Builds a four-file push plan while preserving a non-target remote file that
   changed before planning.
2. Spawns a separate Node apply process with the normal claim-fenced JSONL
   recovery writer, then wraps the writer so the child takes a durable remote
   snapshot and sends itself `SIGKILL` immediately after the second
   `mutation-observed` append returns.
3. Verifies the parent observed `SIGKILL`, the journal is restart-readable, and
   no completed marker exists.
4. Adds a second non-target remote-only edit after the kill, then runs recovery
   inspection and repair replay from the persisted journal.
5. Verifies replay writes only the remaining old planned targets (`file-3.txt`
   and `file-4.txt`), skips the already-new planned targets (`file-1.txt` and
   `file-2.txt`), and leaves the preserved remote-only `file-7.txt` and
   `file-8.txt` values unchanged.

## Validation run

```bash
umask 0022 && node --test --test-name-pattern 'process kill mid mutation set retry preserves remote-only changes' test/recovery-journal.test.js
umask 0022 && node --test --test-name-pattern 'staged state survives restart|committed state survives restart|process kill mid mutation set retry preserves remote-only changes|repair replay mutates only old targets' test/recovery-journal.test.js test/recovery-repair.test.js
umask 0022 && node --test test/recovery-journal.test.js
umask 0022 && node --test test/recovery-repair.test.js
```

Observed result: focused validation exited 0 with 1 subtest; adjacent
recovery retry/process-kill slice exited 0 with 4 subtests; full recovery
journal suite exited 0 with 29 pass / 0 fail; recovery repair suite exited 0
with 5 pass / 0 fail.

## Residual scope

This evidence is limited to the recovery journal/repair retry path for a
file-backed journal after a real process kill during the mutation set. It does
not change generated harness files, plugin-driver verifier flows,
executor-auth routes, storage/performance work, public progress surfaces, or
supervisor reports.
