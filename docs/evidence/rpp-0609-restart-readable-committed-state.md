# RPP-0609 restart-readable committed state evidence

Date: 2026-05-29
Issue: RPP-0609
Lane: recovery

## Proof added

- File-backed and SQLite recovery journal readers now expose a `committedState`
  summary derived from durable `mutation-observed` and `journal-completed` rows.
- The summary reports restart readability, committed row counts, target-envelope
  hash coverage, latest committed mutation metadata, hash-only observed state,
  row-level fsync evidence, and whether every planned target reached a completed
  commit marker.
- The summary exposes committed lease owner identity as hash-bound audit
  evidence: claim id, claim hash/key hash, source row sequence, and source event
  type are read back from the committed audit rows after restart.
- Production recovery journal inspection carries the persisted `committedState`
  so checked recovery surfaces can read the same committed-state evidence.
- Missing, empty, corrupt, unsupported-schema, or hash-incomplete committed rows
  fail closed for committed-state restart readability.

## Focused regression

`test/recovery-journal.test.js` now includes
`file-backed journal committed state survives restart and exposes lease owner identity`:

1. Spawns a separate Node writer process with a claim-fenced JSONL journal.
2. Runs the normal apply path and stops at the injected
   `failDuringCommitAtMutation: 1` boundary after the first `mutation-observed`
   row is fsynced.
3. Re-reads the journal from the parent process and verifies integrity is `ok`,
   `committedState.restartReadable` is true, one target is committed, the
   journal has not written `journal-completed`, and the latest committed hash
   evidence matches the first planned mutation's after hash.
4. Verifies the restart-readable committed audit evidence exposes the lease
   owner identity (`claimId`, `claimHash`, `claimKeyHash`) on the committed row.
5. Runs restart inspection over the partially committed remote and verifies the
   journal remains blocked as partially updated while still carrying the
   committed lease owner identity in `inspection.journal.committedState`.

## Validation run

```bash
umask 0022 && node --test --test-name-pattern 'committed state survives restart' test/recovery-journal.test.js
umask 0022 && node --test test/recovery-journal.test.js
```

Observed result: focused RPP-0609 validation exited 0 with 1 subtest, and the
full recovery journal suite exited 0 with 28 pass / 0 fail.

## Residual scope

This evidence is limited to restart-readable committed-state readback and
claim/lease owner audit identity through the file-backed recovery journal
surface. Classification variants, generated harness targets, graph identity,
plugin driver, executor-auth routes, topology, storage-performance work,
release operations, and public progress publishing remain outside this slice.
