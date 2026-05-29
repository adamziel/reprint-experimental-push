# RPP-0608 restart-readable staged state evidence

Date: 2026-05-29
Issue: RPP-0608
Lane: recovery

## Proof added

- File-backed and SQLite recovery journal readers now expose a `stagedState`
  summary derived from durable `apply-staged` and `dependencies-validated`
  rows.
- The summary reports restart readability, row counts, staged row sequence/type,
  plan id, hash-only observed and staged snapshot evidence, target-envelope hash
  coverage, artifact refs, and the row-level fsync marker.
- Production recovery journal inspection carries the persisted `stagedState` so a
  restarted recovery surface can read the same staged-state evidence.
- Missing, empty, corrupt, unsupported-schema, or hash-incomplete staged rows fail
  closed for staged-state retry: `restartReadable` is false unless integrity is
  `ok` and a staged boundary has a staged snapshot hash.

## Focused regression

`test/recovery-journal.test.js` now includes
`file-backed journal staged state survives restart and retry preserves remote-only changes`:

1. Spawns a separate Node writer process that opens a claim-fenced JSONL journal,
   runs the normal apply path, and stops at the injected `failAfterStaging`
   boundary after the `apply-staged` row is fsynced.
2. Re-reads the journal from the parent process and verifies integrity is `ok`,
   `stagedState.restartReadable` is true, the staged row is sequence-readable,
   target hash coverage matches the plan, the staged snapshot hash matches the
   expected staged candidate, and every row carries `fsync.requested: true`.
3. Uses restart inspection and repair replay from the persisted journal while the
   current remote contains remote-only changes both before the original plan and
   after the simulated crash.
4. Verifies the retry/replay applies only the planned old target and preserves
   both remote-only changes. The JSONL journal text is checked for the staged and
   preserved raw fixture strings and does not contain them.

## Validation run

```bash
umask 0022 && node --test --test-name-pattern 'staged state survives restart' test/recovery-journal.test.js
umask 0022 && node --test test/recovery-journal.test.js
umask 0022 && node --test test/recovery-repair.test.js
```

Observed result: focused RPP-0608 validation exited 0 with 1 subtest, the
full recovery journal suite exited 0 with 27 pass / 0 fail, and the recovery
repair suite exited 0 with 5 pass / 0 fail.

## Residual scope

This evidence is limited to restart-readable staged-state readback and retry
preservation through the recovery journal/repair path. Committed-state,
classification variants, generated harness, graph identity, plugin driver,
executor-auth routes, topology, release operations, and public progress
publishing remain outside this slice.
