# RPP-0602 journal ownership record evidence

Date: 2026-05-29
Issue: RPP-0602
Lane: journal-recovery

## Proof added

- Production recovery journals now append a durable
  `journal-ownership-recorded` row immediately after `journal-opened` and
  before planned target rows for new journal envelopes.
- The row records hash-only journal identity evidence, the claim id/hash when a
  claim is present, `ownsJournal: true`, `restartReadable: true`, the
  `filesystem-compare-rename` storage adapter, and the
  `claim-fenced-restart-readable` supported surface.
- The row is fsynced through the existing append path and is read back by
  `openProductionRecoveryJournal().inspect()` as `journal.ownershipRecord`.
- Same-claim restarts reuse the persisted ownership record instead of adding a
  duplicate row; legacy same-claim restarts can backfill the record without
  rewriting existing target rows.
- The ownership row does not persist raw journal paths or site values. The
  journal identity is retained only as a SHA-256-style digest, and the focused
  test asserts the serialized row does not include the local journal path.

## Focused regression

`test/recovery-journal.test.js` now includes
`production recovery journal ownership record is durable after restart`:

1. Opens a production recovery journal with a claim and artifact reference.
2. Confirms the initial inspection exposes the ownership record at sequence 2.
3. Closes the writer, reads the JSONL journal from disk, and verifies exactly
   one `journal-ownership-recorded` row survived restart readback.
4. Checks the row carries the plan id, claim id/hash, ownership contract,
   append storage guard, fsync evidence, and hash-only journal identity.
5. Reopens the same claim with `truncate: false` and verifies the persisted
   ownership row is reused rather than duplicated.

## Validation run

```bash
umask 0022 && node --test test/recovery-journal.test.js
```

Observed result: 24 pass / 0 fail, including the new ownership restart
readback regression and the existing SQLite schema migration coverage.
