# RPP-0733 apply batch sizing variant 2 evidence

Evidence for RPP-0733. This slice is support-only and builds on the RPP-0713
apply batch sizing proof. Final release remains **NO-GO** because this proof
does not supply a live production remote service, production storage receipts,
production row batch execution, production atomic group commit evidence, or
release-verifier carry-through.

## Proof scope

The focused proof test
`test/rpp-0733-apply-batch-sizing-v2.test.js` exercises local hash-only apply
batch resume evidence for a 10-mutation fixture with a configured apply batch
size of 3.

Variant 2 asserts:

- apply batch windows are deterministic: `[0..2]`, `[3..5]`, `[6..8]`, and
  `[9..9]`;
- the first apply attempt commits the first two batch windows, then stops before
  the third batch;
- resume recognizes exact durable batch receipts for the committed prefix and
  skips those six mutations without opening duplicate mutation work;
- resume applies only the two missing batch windows, for four mutation writes;
- a completed replay skips all four batch receipts with zero mutation work;
- stale receipts, missing committed receipts, duplicate mutation counters,
  drifted storage-boundary checks, and premature passed status fail closed; and
- the proof remains support-only with final release and integration
  recommendation set to `NO-GO`.

## Observed proof summary

Focused local proof summary from this sandbox:

- mutations: `10`
- configured apply batch size: `3`
- apply batches: `4`
- batch sizes: `3`, `3`, `3`, and `1`
- first-attempt committed batches: `2`
- first-attempt applied mutations: `6`
- resume skipped committed batches: `2`
- resume skipped mutation work: `0`
- resume applied missing batches: `2`
- resume applied mutations: `4`
- duplicate mutation work: `0`
- completed replay receipt skips: `4`
- completed replay mutation work: `0`
- final release status: `NO-GO`
- integration recommendation: `NO-GO`

## Variant 2 gates

The RPP-0733 proof recomputes this gate vector from hash-only apply batch and
resume evidence before emitting output:

1. `deterministic-apply-batch-size`
2. `ordered-apply-batches`
3. `complete-mutation-coverage`
4. `batch-window-hashes-match`
5. `deterministic-resume-evidence`
6. `resume-skips-durable-batches`
7. `resume-applies-only-missing-batches`
8. `no-duplicate-mutation-work`
9. `storage-boundary-cas-before-resume-mutations`
10. `hash-only-apply-batch-evidence`
11. `runtime-resource-budget`
12. `support-only-release-no-go`

The public output is emitted only after all twelve gates pass. If evidence
claims `passed` before the gate vector is present and passing, the resolver
blocks the output and records `correctness-gates-not-recorded`.

## Resume behavior

The local proof models apply batches as resumable mutation chunks. A durable
batch receipt binds batch index, mutation offset, mutation count, batch hash,
and planned after-hash set. Resume skips a committed batch only when the receipt
matches the planned batch window exactly.

Recorded posture:

- first attempt outcome: `interrupted-after-committed-batch`
- committed batch indexes: `0`, `1`
- resume mode: `receipt-prefix-skip-then-apply-missing-batches`
- skipped batch indexes: `0`, `1`
- applied batch indexes after resume: `2`, `3`
- max mutation work count: `1`
- duplicate mutation work: `0`
- storage-boundary failures: `0`

## Negative coverage

The focused proof mutates otherwise passing apply batch evidence and verifies
fail-closed behavior:

- stale batch receipt evidence changes a committed receipt's batch hash and
  blocks on `resume-skips-durable-batches`;
- missing committed receipt evidence removes a committed-prefix receipt and
  blocks on `resume-skips-durable-batches`;
- duplicate mutation work evidence increments a mutation work counter and
  blocks on `no-duplicate-mutation-work`;
- drifted resume storage evidence changes a storage-boundary before hash and
  blocks on `storage-boundary-cas-before-resume-mutations`; and
- premature pass evidence clears the recorded gate vector while leaving status
  as `passed`, then blocks on `correctness-gates-not-recorded`.

All unsafe decisions suppress output and record deterministic decision hashes.

## Support-only release posture

This evidence remains support-only:

- `supportOnly: true`
- `productionBacked: false`
- production throughput is `not-claimed`
- speed claims are disabled
- live production remote service is `not-claimed`
- production storage receipts are `not-claimed`
- production row batch execution is `not-claimed`
- production atomic group commit is `not-claimed`
- release-verifier carry-through is `not-claimed`
- final release status is `NO-GO`
- integration recommendation is `NO-GO`

This proof does not claim live production batch sizing, production resume
durability, release approval, or rollout safety. It proves only local hash-only
apply batch resume accounting, storage-boundary ordering for resumed mutations,
and fail-closed stale or incomplete resume evidence behavior.

## Redaction posture

Batch resume evidence is hash-and-count-only. It stores sequence bounds,
counts, mutation-id hashes, resource-key hashes, storage hashes, batch hashes,
receipt hashes, collection hashes, and gate decision hashes. It does not store
row payloads, option values, post content, meta values, file bytes, paths, live
service configuration, bearer tokens, external URLs, or private site values.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0733-apply-batch-sizing-v2.test.js`
- `node --test --test-name-pattern RPP-0733 test/rpp-0733-apply-batch-sizing-v2.test.js`
- `node --test --test-name-pattern RPP-0713 test/rpp-0713-apply-batch-sizing.test.js`
- `node --test --test-name-pattern RPP-0732 test/rpp-0732-dry-run-batch-sizing-v2.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0733-apply-batch-sizing-v2.md`
- `git diff --check`
- `git diff --cached --check`

Observed focused proof result:

- RPP-0733 proof test: 2 pass, 0 fail
- Adjacent RPP-0713 apply batch sizing test: 3 pass, 0 fail
- Adjacent RPP-0732 dry-run batch sizing variant 2 test: 2 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace checks: clean
