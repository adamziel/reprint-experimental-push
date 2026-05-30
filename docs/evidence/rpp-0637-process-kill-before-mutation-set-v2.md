# RPP-0637 process kill before mutation set, variant 2

Date: 2026-05-30
Lane: recovery journal/idempotency
Release status: focused evidence only; broader integration still decides release posture.

## Claim

A hard process kill after durable recovery rows are fsynced, but before the
first target mutation runs, must restart from hash-only journal evidence and
allow exactly one retry to finish the planned mutation set.

## Focused proof

`test/recovery-journal.test.js` adds
`RPP-0637 process kill before mutation set retries exactly once`.

The test starts a separate Node writer process that:

- opens a claim-fenced file-backed recovery journal;
- writes the claim, `journal-opened`, every `target-planned` row,
  `apply-staged`, `dependencies-validated`, and `apply-committing` through the
  normal fsyncing append path; and
- blocks inside the `beforeMutation` hook for mutation 1, before any
  `setResource()` call or `mutation-observed` row can run.

The parent test waits for the hook marker, reads the still-open journal, and
sends `SIGKILL` to the child. After restart/readback it proves:

- the pre-kill rows are intact and monotonic;
- no `mutation-observed` or `journal-completed` row exists before the kill;
- the claim row, open state, and staged state remain restart-readable;
- recovery inspection classifies every planned target as `old-remote`; and
- the JSONL journal contains only hashes/metadata, not fixture raw values.

The retry uses `replayRecoveryRepair()` from the restarted journal against the
old remote. It records exactly one write per planned mutation, converges every
target to the after hash, and a second replay attempt fails as already complete
without issuing any writes. That proves the post-kill retry finishes the
mutation set exactly once.

## Validation

```bash
node --check test/recovery-journal.test.js
node --test --test-name-pattern='RPP-0637' test/recovery-journal.test.js
node --test --test-name-pattern='RPP-0637|staged state survives restart|committed state survives restart|same-claim retry|restart inspection classifies|restart inspection treats|restart inspection blocks' test/recovery-journal.test.js
node --test test/recovery-journal.test.js
node --test test/recovery-repair.test.js
npm run test:recovery:file-journal
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0637-process-kill-before-mutation-set-v2.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed result: all listed commands exited 0. The focused RPP-0637 run reported
1 pass / 0 fail, the adjacent recovery/retry slice reported 11 pass / 0 fail, the
full recovery journal suite reported 29 pass / 0 fail, the recovery repair suite
reported 5 pass / 0 fail, the file-journal restart smoke returned 0, checklist
lint returned `"ok": true`, and the scoped redaction scan returned `"ok": true`.

## Residual scope

This evidence is limited to a file-backed recovery journal process-kill window
before the mutation set and the recovery repair retry path. It does not change
generated harnesses, plugin-driver verifiers, executor-auth routes,
storage/performance surfaces, topology checks, release operations, or progress
publishing.
