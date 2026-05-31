# RPP-0667 restart-readable open state variant 4 evidence

Date: 2026-05-31
Issue: RPP-0667
Lane: recovery

## Scope

This is focused local regression coverage for restart-readable open-state rows.
It uses the production-shaped recovery journal wrapper against a sandbox
file-backed JSONL journal and verifies readback after a child-process writer
boundary. It does not prove a live production-backed durable journal boundary
and keeps release posture NO-GO.

## Proof added

- Added `test/rpp-0667-restart-readable-open-state-v4.test.js`.
- The child process opens a claim-fenced production-shaped recovery journal and
  emits the writer inspection surface without explicitly closing the journal.
- The parent process rereads the JSONL journal after the process boundary and
  verifies durable `journal-opened`, `journal-ownership-recorded`,
  `target-planned`, and `recovery-claim-opened` rows.
- A same-claim retry happens in a second child process after restart readback.
  Parent readback proves the earlier rows are byte-for-byte preserved, exactly
  one `journal-retry-opened` row is appended, and open-state summary fields
  remain restart-readable.
- The regression checks monotonic sequences, row-level fsync markers,
  claim-hash continuity, artifact references, hash-only observed state, and
  restart inspection continuing to classify the unchanged remote as
  `old-remote`.
- Scope evidence in the test marks `localRecoverySupport.proved: true` and
  `productionBackedDurableJournalProof.proved: false` with
  `LOCAL_SANDBOX_ONLY`.

## Redaction

The test checks every journal row with `assertJournalRecordHasNoRawValues()` and
scans writer inspections, restart inspections, evidence summaries, and the raw
JSONL journal text for fixture payload values. Exposed evidence stays hash-only:
latest open row identity and journal row identity use SHA-256-shaped digests.

## Validation run

```bash
node --check test/rpp-0667-restart-readable-open-state-v4.test.js
node --test --test-name-pattern RPP-0667 test/rpp-0667-restart-readable-open-state-v4.test.js
node --test --test-name-pattern RPP-0647 test/rpp-0647-restart-readable-open-state-v3.test.js
node --test --test-name-pattern 'open state survives|RPP-0627' test/recovery-journal.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0667-restart-readable-open-state-v4.md
git diff --check
git diff --cached --check
```

Observed local results before commit:

- Syntax check exited 0.
- Focused RPP-0667 test passed 1 subtest, 0 failures.
- RPP-0647 variant 3 restart-readable open-state regression passed 3 subtests,
  0 failures. Node emitted the expected experimental `node:sqlite` warning for
  the SQLite mirror subtest.
- Recovery-journal open-state readback group passed 2 subtests, 0 failures.
  Node emitted the expected experimental `node:sqlite` warning while loading the
  broader recovery-journal suite.
- Scoped artifact redaction scan exited 0.
- Working-tree whitespace diff check exited 0.
- Cached whitespace diff check exited 0.

## Integration recommendation

Integrate after the focused validation commands stay green on the merge lane.
This variant is intentionally limited to open-state row durability after a
process boundary and should not be used as coverage for single-writer lease
claiming, stale-claim rejection, claim expiry policy, or journal pagination.
