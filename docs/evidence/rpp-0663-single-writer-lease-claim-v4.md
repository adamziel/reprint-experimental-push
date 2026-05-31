# RPP-0663 single-writer lease claim variant 4 evidence

Date: 2026-05-31
Issue: RPP-0663
Lane: journal-recovery

## Scope

This is focused local recovery-journal regression coverage. It proves the
claim-fenced file-backed journal keeps single-writer lease behavior on retry
and refuses to overwrite preserved remote changes before mutation-capable work
can run. Final release status remains gated by the broader production-owned
durable storage and live release boundary evidence.

## Proof added

- Added standalone coverage in
  `test/rpp-0663-single-writer-lease-claim-v4.test.js`.
- The competing-claim case opens an active claim-fenced production recovery
  journal, then attempts a second claim before the stale threshold against a
  remote snapshot with preserved changes on planned targets. The second claim
  records durable stale-claim rejection evidence, stays out of the active
  writer set, and leaves the preserved remote snapshot unchanged.
- The active-claim retry reopens the same writer lease against the preserved
  remote snapshot and then attempts to apply the plan. The live precondition
  check fails with hash-only `PRECONDITION_FAILED` evidence before any mutation
  event is appended, and the preserved remote snapshot is unchanged.
- The expired-lease case advances exactly one retry claim after the stale
  threshold, exposes the restart-readable single-writer lease for the retry
  claim, and proves the same precondition failure and no-overwrite behavior
  before mutation.
- Both cases inspect the preserved remote snapshot after restart and require
  `blocked-recovery` with two unknown changed targets and zero mutation rows.
  Persisted journal rows and inspection/error evidence are checked for
  hash-only content with no raw fixture payloads.

## Validation run

```bash
node --check test/rpp-0663-single-writer-lease-claim-v4.test.js
node --test --test-name-pattern RPP-0663 test/rpp-0663-single-writer-lease-claim-v4.test.js
node --test --test-name-pattern RPP-0643 test/rpp-0643-single-writer-lease-claim-v3.test.js
node --test --test-name-pattern 'claim|lease' test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0663-single-writer-lease-claim-v4.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0663 run passed 2 subtests, 0 failures.
- Predecessor RPP-0643 run passed 2 subtests, 0 failures.
- Adjacent recovery journal `claim|lease` run passed 15 subtests, 0
  failures. Node emitted the expected experimental SQLite warning while running
  SQLite-adjacent coverage.
- Scoped artifact redaction scan was clean.
- Unstaged and staged whitespace diff checks were clean.
