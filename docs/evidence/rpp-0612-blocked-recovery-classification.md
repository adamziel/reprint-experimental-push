# RPP-0612 blocked recovery classification evidence

Date: 2026-05-30
Issue: RPP-0612
Lane: recovery

## Proof added

- `test/recovery-journal.test.js` now includes
  `file-backed journal blocked recovery classification survives process restart`.
- The regression spawns a separate Node writer process, opens a claim-fenced
  file-backed recovery journal, applies an eight-target ready plan, and stops at
  the injected `failDuringCommitAtMutation: 2` boundary.
- The parent process then re-reads the JSONL journal after the writer exits and
  verifies integrity is `ok`, sequences are monotonic, all target-planned rows
  remain present, two `mutation-observed` rows are durable, no
  `journal-completed` row was written, every row carries fsync evidence, and the
  persisted recovery-state row is `blocked-recovery`.
- Restart inspection over the persisted journal classifies the current partial
  remote as `blocked-recovery` with 2 new targets, 6 old targets, and 0
  blocked-unknown targets. This pins the blocked classification to the durable
  journal rows rather than to in-memory apply state.

## Validation run

```bash
node --check test/recovery-journal.test.js
node --test --test-name-pattern 'blocked recovery classification survives process restart' test/recovery-journal.test.js
node --test --test-name-pattern '(restart inspection|blocked recovery classification survives process restart|state survives restart)' test/recovery-journal.test.js
node --test test/recovery-journal.test.js
npm run test:recovery:file-journal
```

Observed result: syntax check exited 0, focused RPP-0612 coverage exited 0 with
1 subtest, the adjacent restart/classification slice exited 0 with 9 subtests,
the full recovery journal suite exited 0 with 29 subtests, and the file-backed
restart smoke exited 0 with the fail-after-2 scenario classified as
`blocked-recovery` with 6 old, 2 new, and 0 blocked-unknown targets.

## Residual scope

This evidence is limited to file-backed recovery journal restart readback and
blocked recovery classification. It does not cover generated harness cases,
plugin-driver behavior, executor-auth replay, storage benchmarking, public
progress publishing, or production release movement.
