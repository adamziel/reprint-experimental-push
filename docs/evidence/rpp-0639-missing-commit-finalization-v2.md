# RPP-0639 missing commit finalization proof, variant 2

Date: 2026-05-30
Issue: RPP-0639
Lane: recovery

## Proof added

- Added a focused file-backed recovery journal restart proof for the case where
  every planned mutation has a durable `mutation-observed` row but the terminal
  `journal-completed` row is missing after the writer exits.
- The proof reopens the same claim-fenced journal, appends only the missing
  `journal-completed` row, and verifies no mutation rows are added or rewritten.
- Restart inspection reports `fully-updated-remote` before and after the
  finalization because every target already matches its journaled after hash.
- The audit evidence exposes lease owner identity before finalization on the
  latest `mutation-observed` row and after finalization on the new
  `journal-completed` row: `claimId`, `claimHash`, `claimKeyHash`, source
  sequence, and source event type are restart-readable.
- The finalization row is fsynced, carries only hash/reference metadata, and the
  journal text is checked for absence of the RPP-0639 private fixture marker.

## Focused regression

`test/recovery-journal.test.js` now includes
`RPP-0639 file-backed missing commit finalization preserves mutation rows and exposes lease owner identity`:

1. Spawns a separate Node writer with a claim-fenced JSONL journal.
2. Injects failure at the last mutation boundary, after all mutation rows are
   durable and before `journal-completed` can be written.
3. Re-reads the journal after process exit and verifies the committed state is
   restart-readable, still missing completion, and exposes the writer lease
   owner identity from the last mutation row.
4. Reopens the journal with the same claim, appends the missing completion row,
   and proves mutation rows are unchanged.
5. Re-reads the finalized journal and verifies the committed state is completed,
   all targets are committed, and lease owner identity moved to the completion
   audit row.

## Validation run

```bash
umask 0022 && node --test --test-name-pattern 'RPP-0639' test/recovery-journal.test.js
umask 0022 && node --test --test-name-pattern 'committed state survives restart|RPP-0639|refuses completion|completed replay|fully updated no-op state|appends monotonic sequences|supports paged restart readback|production recovery journal ownership record' test/recovery-journal.test.js
umask 0022 && node --test test/recovery-journal.test.js
umask 0022 && npm run test:recovery:file-journal
umask 0022 && node scripts/release/checklist-completion-lint.mjs --root .
umask 0022 && node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0639-missing-commit-finalization-v2.md docs/reprint-push-completion-checklist.md
git diff --check
git diff --cached --check
```

Observed results: focused RPP-0639 validation exited 0 with 1 subtest / 0 fail; adjacent recovery restart/finalization validation exited 0 with 7 subtests / 0 fail; full recovery journal suite exited 0 with 43 subtests / 0 fail; file journal restart smoke exited 0; checklist completion lint exited 0; scoped artifact redaction scan exited 0; the raw fixture scan found no private RPP-0639 fixture values in touched docs; and merge diff whitespace checks exited 0.

## Residual scope

This evidence is limited to the recovery journal missing-completion finalization
proof and claim/lease owner audit identity on the file-backed journal surface.
Generated harness variants, plugin driver surfaces, executor-auth routes,
storage/performance work, progress publishing, and supervisor reports remain
outside this slice.
