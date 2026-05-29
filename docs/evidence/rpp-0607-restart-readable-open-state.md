# RPP-0607 restart-readable open state evidence

Date: 2026-05-29
Issue: RPP-0607
Lane: recovery

## Proof added

- File-backed and SQLite recovery journal readers now expose an `openState`
  summary derived from durable `journal-opened` and `journal-retry-opened` rows.
- The summary reports the restart-readability decision, row counts, first/latest
  open row sequence, latest open row type/state, plan id, hash-only observed
  snapshot evidence, artifact refs, and the row-level fsync marker.
- Production recovery journal inspection carries the persisted `openState` so
  checked recovery surfaces can read the same open-state evidence after a
  restart.
- Missing, empty, corrupt, or unsupported-schema journals fail closed for open
  state: they keep parsed row counts where available, but `restartReadable` is
  false unless the journal integrity is `ok` and an open row exists.

## Focused regression

`test/recovery-journal.test.js` now includes
`file-backed journal open state survives process restart readback`:

1. Spawns a separate Node writer process that opens a plan recovery journal and
   appends the `journal-opened` row plus target rows through the normal fsyncing
   append path.
2. Exits that writer process without an explicit `close()` call to model a
   restart boundary after the open state is written.
3. Re-reads the JSONL journal from the parent process and verifies integrity is
   `ok`, `openState.restartReadable` is true, sequence numbers are monotonic,
   the open row is sequence 1, all planned target rows are present, and every
   row carries `fsync.requested: true`.
4. Runs restart inspection over the same persisted file and verifies the opened
   journal still classifies the unchanged remote as `old-remote` while exposing
   the restart-readable open state.

## Validation run

```bash
umask 0022 && node --test --test-name-pattern 'open state survives process restart' test/recovery-journal.test.js
umask 0022 && node --test test/recovery-journal.test.js
```

Observed result: focused RPP-0607 validation exited 0 with 1 subtest, and the
full recovery journal suite exited 0 with 26 pass / 0 fail.

## Residual scope

This evidence is limited to the recovery journal open-state surface and its
file-backed restart readback. Staged-state, committed-state, DB process-kill,
storage CAS, topology, executor route behavior, generated harness, and release
operations evidence remain outside this slice.
