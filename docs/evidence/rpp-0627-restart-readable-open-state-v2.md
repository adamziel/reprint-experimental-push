# RPP-0627 restart-readable open state, variant 2

Date: 2026-05-30
Issue: RPP-0627
Lane: recovery
Checklist item: RPP-0627 - Prove restart-readable open state, variant 2.

## Proof added

- `test/recovery-journal.test.js` now includes
  `RPP-0627 production recovery journal open state remains restart-readable after process restart retry`.
- The proof reuses the RPP-0607 open-state readback surface, but exercises it
  through `openProductionRecoveryJournal()` and a claim-fenced same-claim retry.
- The first writer process opens the production recovery journal and exits
  without an explicit close. The parent process reads the JSONL file and verifies
  durable `journal-opened`, `journal-ownership-recorded`, `target-planned`, and
  `recovery-claim-opened` rows.
- A second writer process reopens the same journal with the same claim after the
  restart boundary, appends `journal-retry-opened`, and emits the production
  inspection surface. Parent readback verifies `openState` matches that
  production inspection exactly.
- The readback proof checks monotonic sequences, row-level fsync evidence,
  single ownership and claim rows, no duplicate target envelope, hash-only
  observed state, redacted journal records, and restart inspection continuing to
  classify the unchanged remote as `old-remote`.

## Validation run

```bash
node --test --test-name-pattern 'RPP-0627' test/recovery-journal.test.js
node --test --test-name-pattern 'open state survives|RPP-0627|staged state survives|committed state survives' test/recovery-journal.test.js
node --test test/recovery-journal.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0627-restart-readable-open-state-v2.md docs/reprint-push-completion-checklist.md
```

Observed result: focused RPP-0627 validation exited 0 with 1 pass / 0 fail,
the adjacent restart-readable recovery group exited 0 with 4 pass / 0 fail, and
the full recovery journal suite exited 0 with 29 pass / 0 fail. Checklist lint
and the scoped Markdown redaction scan both exited 0.

## Residual scope

This evidence is limited to production-wrapper recovery journal open-state
readback after process restart and same-claim retry. Staged-state,
committed-state, storage, topology, route replay, release-ops, and generated
coverage variants remain outside this slice.
