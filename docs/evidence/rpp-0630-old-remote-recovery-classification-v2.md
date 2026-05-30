# RPP-0630 old remote recovery classification evidence

Date: 2026-05-30
Issue: RPP-0630
Lane: recovery

## Proof added

- Added a second old-remote recovery classification proof for the file-backed
  production recovery journal.
- The proof writes the claim-fenced journal from a separate Node process, exits
  before any mutation observation or journal completion row, and reopens the
  JSONL journal from the parent process.
- Restart inspection verifies every planned target matches its journaled before
  hash, no target matches its after hash, and the recovery state is
  `old-remote` with all counts in the `old` bucket.
- The proof advances an expired claim on the same persisted journal and feeds
  the hash-only `old-remote` classification into the existing durable recovery
  journal release proof helper.
- The release proof reports `GATE-2`, `gateStatus: proven`,
  `checks.oldState: true`, and `partialStates.old.proved: true` on the same
  release-boundary path.

## Focused regression

`test/recovery-journal.test.js` now includes
`RPP-0630 old-remote restart classification carries through release proof`:

1. Builds a two-target plan with private local payloads.
2. Opens a production recovery journal in a child process and exits before
   mutation work begins.
3. Re-reads the journal in the parent process and asserts the journal is
   restart-readable, fsynced, hash-only, and still lacks mutation observation or
   journal completion rows.
4. Runs restart inspection and verifies the unchanged remote classifies as
   `old-remote` with `{ old: 2, new: 0, blockedUnknown: 0 }`.
5. Reopens the expired claim, preserves the same target envelope, and carries
   the old-remote classification into the release proof summary.

## Validation run

```bash
umask 0022 && node --test --test-name-pattern 'RPP-0630' test/recovery-journal.test.js
umask 0022 && node --test --test-name-pattern 'old remote|fail-after-2|completed replay|outside before and after|missing target records|corrupt or truncated' test/recovery-journal.test.js
umask 0022 && node --test test/recovery-journal.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0630-old-remote-recovery-classification-v2.md
git diff --check
git diff --cached --check
```

Observed result: focused RPP-0630 validation exited 0 with 1 subtest, adjacent
recovery classification validation exited 0 with 6 subtests, and the full
recovery journal suite exited 0 with 29 subtests. Checklist lint and scoped
artifact redaction scan both reported `ok: true`; both git diff whitespace
checks exited 0 with no output.

## Residual scope

This evidence is limited to recovery journal restart classification and the
existing durable recovery journal release proof helper. Generated harness work,
plugin-driver behavior, executor-auth replay, storage benchmarking, public
progress publishing, and topology evidence remain outside this slice.
