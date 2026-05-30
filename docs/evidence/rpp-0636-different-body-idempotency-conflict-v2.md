# RPP-0636 different-body idempotency conflict, variant 2

Date: 2026-05-30
Lane: recovery journal/idempotency
Release status: focused evidence only; broader integration still decides release posture.

## Claim

Reusing an idempotency key with a different request body must return
`IDEMPOTENCY_KEY_CONFLICT`, preserve the target snapshot, and avoid all fresh
mutation work after the conflict is recorded.

## Focused proof

`test/recovery-journal.test.js` adds
`RPP-0636 SQLite-backed different-body idempotency conflict proves no post-conflict mutation`.

The test writes a restart-read SQLite recovery journal table with:

- one `idempotency-opened` row for the original request hash;
- one original `apply-started` row;
- one `mutation-applied` row per planned mutation;
- one `apply-committed` row and one same-key/body `apply-replayed` row; and
- one `idempotency-key-conflict` row for the same idempotency key hash with a
  different request hash.

The conflict row proves:

- `status: 409` and `code: IDEMPOTENCY_KEY_CONFLICT`;
- the idempotency key hash matches the opened claim;
- the conflicting request hash differs from the original request hash;
- `freshMutationWork` is false;
- before/after conflict target snapshot hashes are identical; and
- no `apply-started` or `mutation-applied` rows exist after the conflict row.

The test also asserts the conflict row is hash-only with
`assertJournalRecordHasNoRawValues()`, feeds the SQLite-derived journal events
into `buildDurableRecoveryJournalReleaseProof()`, and verifies
`sameKeyDifferentBodyConflict.proved` is true. A negative sub-check appends a
synthetic post-conflict `mutation-applied` event to the proof input and verifies
the same proof flips false.

## Validation

```bash
node --test --test-name-pattern=RPP-0636 test/recovery-journal.test.js
node --test --test-name-pattern='RPP-0636|same-claim retry|restart inspection classifies|restart inspection treats|restart inspection blocks|checked durable journal boundary' test/recovery-journal.test.js
node --test test/recovery-journal.test.js
npm run test:recovery:file-journal
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0636-different-body-idempotency-conflict-v2.md docs/reprint-push-completion-checklist.md
git diff --check
```

Observed result: all listed commands exited 0. The focused RPP-0636 run reported
1 pass / 0 fail; the adjacent recovery idempotency/classification run reported
10 pass / 0 fail; the full recovery journal suite reported 40 pass / 0 fail;
the recovery file-journal smoke preserved old, blocked, completed-replay, and
drift classifications; checklist lint returned `"ok": true`; and the scoped
redaction scan returned `"ok": true`.
