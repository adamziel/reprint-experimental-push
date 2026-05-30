# RPP-0632 blocked recovery classification, variant 2

Date: 2026-05-30
Issue: RPP-0632
Lane: recovery

## Proof added

- `test/recovery-journal.test.js` now includes
  `RPP-0632 blocked recovery classification variant 2 survives process restart with durable rows`.
- The regression runs the apply path in a separate Node process with a
  claim-fenced JSONL recovery journal and an injected failure during the second
  committed mutation.
- The parent process reopens the persisted journal after the child exits and
  proves the rows are durable: claim/open rows, all eight target rows, staged and
  dependency boundaries, committing boundary, two `mutation-observed` rows, and
  a `blocked-recovery` recovery-state row are present with monotonic sequences.
- Restart inspection classifies the reconstructed partial remote as
  `blocked-recovery` with `2 new`, `6 old`, and `0 blockedUnknown` targets, and
  the committed-state summary remains restart-readable without a completed
  marker.
- The test verifies the JSONL file contains no raw base or local fixture payload
  values.

## Validation run

```bash
node --test --test-name-pattern 'RPP-0632' test/recovery-journal.test.js
node --test --test-name-pattern 'restart inspection classifies fail-before mutation journal as old remote|restart inspection treats completed replay as fully updated no-op state|RPP-0632' test/recovery-journal.test.js
node --test test/recovery-journal.test.js
node scripts/release/checklist-completion-lint.mjs --root .
node -e "const fs=require('node:fs'); const files=['docs/evidence/rpp-0632-blocked-recovery-classification-v2.md','docs/reprint-push-completion-checklist.md']; const needles=['base'+'-private-content','local'+'-private-content','private'+'-content-rpp-0632','unexpected'+'-remote-edit']; for (const file of files) { const text=fs.readFileSync(file,'utf8'); for (const needle of needles) { if (text.includes(needle)) { console.error(file+': raw needle present'); process.exit(1); } } }"
git diff --check
git diff --cached --check
```

Observed result: focused RPP-0632 validation exited 0 with 1 pass, adjacent
old/new/blocked classification validation exited 0 with 3 pass, the full
recovery journal suite exited 0 with 29 pass / 0 fail, checklist lint returned
`ok: true`, the scoped redaction scan found no raw fixture needles in the
evidence/checklist docs, and both diff whitespace checks exited 0.

## Residual scope

This evidence is limited to file-backed recovery journal restart readback and
blocked classification for a partial commit. MySQL/SQLite storage adapters,
generated harness work, plugin-driver paths, executor-auth replay, storage
benchmarks, release verifier carry-through, progress publishing, and supervisor
reports remain outside this slice.
