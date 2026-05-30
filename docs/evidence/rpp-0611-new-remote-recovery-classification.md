# RPP-0611 new-remote recovery classification evidence

Date: 2026-05-30
Lane: RPP-0611 new remote recovery classification, variant 1
Checklist item: RPP-0611 — Implement new remote recovery classification, variant 1.

## Invariant

When every planned target matches its journaled after hash, restart inspection
must explicitly classify the target envelope as `new-remote` while retaining the
existing safe apply status `fully-updated-remote`. Preserved remote-only
resources remain unplanned, carry only `keep-remote` hash evidence, and must not
be overwritten by recovery replay or repair marking.

## Evidence added

- `src/recovery-inspect.js` now emits a non-breaking `remoteClassification`
  object for every inspection result. Fully updated planned targets map to
  `remoteClassification.state === "new-remote"` with the evidence contract
  `hash-only-before-after-target-envelope`.
- `test/rpp-0611-new-remote-recovery-classification.test.js` builds a focused
  local-mutation plus preserved-remote fixture. The plan has one planned file
  target and one remote-only `keep-remote` decision with no mutation or
  precondition for the preserved resource.
- The focused JSONL proof writes a completed hash-only durable journal, inspects
  it as `new-remote`, verifies repair replay refuses as already complete with no
  writes, marks the journal repaired, and confirms the preserved remote-only
  resource is unchanged.
- The SQLite proof copies the same hash-only journal rows into a SQLite recovery
  table, reads them through `readSqliteRecoveryJournalTable()`, and verifies the
  same `new-remote` classification.

## Redaction proof

The focused and SQLite tests serialize only journal rows, target summaries,
counts, hashes, and classification metadata. Assertions reject the private local
payload and both preserved remote payloads from the journal/classification
evidence, while `assertJournalRecordHasNoRawValues()` checks every durable row.

## Commands

```sh
node --check test/rpp-0611-new-remote-recovery-classification.test.js
node --test test/rpp-0611-new-remote-recovery-classification.test.js
node --test test/recovery-journal.test.js test/recovery-repair.test.js
node --test test/production-shaped-proof.test.js test/release-verifier-recovery-inspect-carry-through-focused-regression.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0611-new-remote-recovery-classification.md
git diff --check
```

Observed result: focused RPP-0611 validation exits 0 with the focused classifier
and SQLite-backed subtests passing. The combined recovery journal/repair command
exits 0 with 33/33 subtests passing. The production-shaped/release-verifier
regression command exits 0 with 125 passing and 11 skipped subtests. Checklist
lint and artifact redaction scan both report `ok: true`.

## Residual scope

This is a local recovery-classifier and SQLite recovery-table proof. It does not
claim production MySQL/InnoDB durability, remote HTTP route coverage, generated
harness coverage, or a final release verdict.
