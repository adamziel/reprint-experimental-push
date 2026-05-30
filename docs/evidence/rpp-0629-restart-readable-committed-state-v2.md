# RPP-0629 restart-readable committed state evidence

Date: 2026-05-30
Issue: RPP-0629
Lane: recovery

## Proof added

- Added a second committed-state restart readback proof for the file-backed
  recovery journal.
- The proof writes the journal from a separate Node process, applies every
  planned mutation, exits after the durable `journal-completed` row, and reopens
  the JSONL file from the parent process.
- Restart readback verifies `committedState.restartReadable`, target-envelope
  completion, row-level `fsync` markers, completed-row sequence evidence,
  hash-only latest mutation metadata, and lease owner identity on the completed
  audit row.
- Restart inspection over the committed remote classifies the same persisted
  journal as `fully-updated-remote` while carrying the committed lease owner
  identity through the inspection surface.
- The focused regression also checks that the committed fixture payload strings
  are absent from the persisted JSONL journal.

## Focused regression

`test/recovery-journal.test.js` now includes
`RPP-0629 committed-state completion row survives restart and exposes lease owner identity`:

1. Creates a two-mutation ready plan and opens a claim-fenced JSONL journal in a
   child process.
2. Applies the plan through the normal durable journal path and lets the child
   process exit only after `journal-completed` is written.
3. Re-reads the journal from the parent process and verifies integrity,
   monotonic sequences, mutation row count, completed row count, target envelope
   completion, and all row-level fsync markers.
4. Verifies the restart-readable committed audit evidence exposes `claimId`,
   `claimHash`, and `claimKeyHash` from the completed row after the process
   boundary.
5. Runs restart inspection against the committed remote and verifies the
   inspection surface still reports the same lease owner identity.

## Validation run

```bash
umask 0022 && node --test --test-name-pattern 'RPP-0629' test/recovery-journal.test.js
umask 0022 && node --test --test-name-pattern 'open state survives process restart|staged state survives restart|committed state survives restart|RPP-0629' test/recovery-journal.test.js
umask 0022 && node --test test/recovery-journal.test.js
```

Observed result: focused RPP-0629 validation exited 0 with 1 subtest, adjacent
restart-readable readback validation exited 0 with 4 subtests, and the full
recovery journal suite exited 0 with 29 pass / 0 fail.

## Residual scope

This evidence is limited to recovery journal committed-state restart readback
and lease owner audit identity. Generated harness work, plugin-driver behavior,
executor-auth replay, storage benchmarking, release verifier carry-through, and
public progress publishing remain outside this slice.
