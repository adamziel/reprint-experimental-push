# RPP-0718 timeout budget proof evidence

Evidence for RPP-0718. This slice adds a guarded-executor timeout budget proof
for chunked file transfer: an upload attempt can exhaust its bounded transfer
budget before apply starts, then a later attempt resumes from exact durable chunk
receipts without replaying mutation work.

## Proof behavior

The benchmark report now emits `evidence.timeoutBudgetProof` and mirrors it at
`evidence.guardedTransfer.timeoutBudgetProof` with:

- proof id: `rpp-0718-timeout-budget-proof`
- variant: `1`
- budget scope: one chunk transfer attempt
- timeout rule: stop before the next unacknowledged chunk when it would exceed
  the attempt budget
- resume rule: skip chunks only from exact plan/resource/range/digest receipt
  evidence, and upload the unacknowledged remainder
- apply rule: mutation apply opens only after file staging finalizes, and no
  mutation work is replayed during transfer resume

## Focused validation

Command:

- `node --test --test-name-pattern RPP-0718 test/rpp-0718-timeout-budget-proof.test.js`

Result:

- 1 test, 1 ok, 0 failed

Integrated lane validation also passed:

- syntax checks for `src/timeout-budget-proof.js`,
  `scripts/bench/guarded-executor-benchmark.js`,
  `test/rpp-0718-timeout-budget-proof.test.js`, and
  `test/guarded-executor-benchmark.test.js`;
- `node --test test/rpp-0718-timeout-budget-proof.test.js test/guarded-executor-benchmark.test.js`
  with 10 tests ok and 0 failed;
- checklist completion lint;
- scoped artifact redaction scan for this evidence document and the checklist;
- raw fixture scan for benchmark payload labels and row values; and
- merge diff whitespace checks.

Observed focused evidence from the guarded executor benchmark:

- file size: 1,048,576 bytes
- chunk size: 262,144 bytes
- chunk count: 4
- timeout budget: 2,500 ms for the simulated transfer attempt
- durable receipts before timeout: 2
- unacknowledged chunks at timeout: 2
- unacknowledged chunks incorrectly marked complete: 0
- chunks skipped by receipt on resume: 2
- chunks uploaded after resume: 2
- duplicate chunk bytes: 0
- duplicate mutation work during transfer resume: 0
- mutation work before timeout: 0
- mutation work before transfer finalization: 0
- apply opened after transfer finalization: true
- evidence hash: `e55a2b5637677cf66f9153320279736807b528ed6e86f8567d2115eec19ff0e1`

## Limits

This is lab guarded-executor timeout-budget evidence. It does not claim
production transport deadlines, production storage receipts, production row
batching, production atomic group commit, or database rollback behavior.

## Redaction posture

Timeout budget evidence is hash-and-count only: receipt keys are represented by
SHA-256 hashes in the proof projection, and raw row payloads, file bytes, plugin
payloads, and private site values are not included.
