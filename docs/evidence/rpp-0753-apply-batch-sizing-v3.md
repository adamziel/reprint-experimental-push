# RPP-0753 apply batch sizing variant 3 evidence

Evidence for RPP-0753. This variant adds deterministic local generated
coverage for apply batch sizing resume behavior. The proof is support-only and
builds on the RPP-0713 apply batch sizing contract and the RPP-0733 resume
proof shape. Final release remains **NO-GO** because this evidence does not
supply a live production remote service, production storage receipts,
production row batch execution, production atomic group commit evidence, or
release-verifier carry-through.

## Proof scope

The standalone proof test
`test/rpp-0753-apply-batch-sizing-v3.test.js` models apply batches as resumable
transfer chunks and verifies that resume skips durable committed chunks without
opening duplicate mutation work.

Variant 3 asserts:

- apply batch sizing creates four deterministic transfer chunks for thirteen
  mutations at configured size four;
- the first attempt commits the first two chunks, then stops before the third
  chunk;
- resume recognizes exact durable receipts for the committed prefix and skips
  eight committed mutations with zero mutation work;
- resume applies only the two missing chunks, for five mutation writes;
- a completed replay skips all four receipts with zero mutation work;
- generated stale receipt, missing receipt, duplicate work, drifted storage,
  raw-value leak, out-of-order chunk, over-budget, and premature pass cases all
  fail closed; and
- final release status and integration recommendation stay `NO-GO`.

## Observed proof summary

Focused local proof summary from this sandbox:

- mutations: `13`
- configured apply batch size: `4`
- transfer chunks: `4`
- chunk sizes: `4`, `4`, `4`, and `1`
- first-attempt committed chunks: `2`
- first-attempt applied mutations: `8`
- resume skipped committed chunks: `2`
- resume skipped mutation work: `0`
- resume applied missing chunks: `2`
- resume applied mutations: `5`
- duplicate mutation work: `0`
- completed replay receipt skips: `4`
- completed replay mutation work: `0`
- generated cases: `9`
- generated safe outputs: `1`
- generated blocked cases: `8`
- unsafe outputs: `0`
- final release status: `NO-GO`
- integration recommendation: `NO-GO`

## Variant 3 gates

The RPP-0753 proof recomputes this gate vector from hash-only chunk transfer
and resume evidence before emitting output:

1. `deterministic-apply-batch-size`
2. `ordered-transfer-chunks`
3. `complete-mutation-coverage`
4. `chunk-window-hashes-match`
5. `deterministic-resume-evidence`
6. `resume-skips-durable-chunks`
7. `resume-applies-only-missing-chunks`
8. `no-duplicate-mutation-work`
9. `storage-boundary-cas-before-resume-mutations`
10. `hash-only-chunk-transfer-evidence`
11. `runtime-resource-budget`
12. `support-only-release-no-go`

The public output is emitted only after all twelve gates pass. If evidence
claims `passed` before the gate vector is present and passing, the resolver
blocks the output and records `correctness-gates-not-recorded`.

## Resume behavior

The local proof treats configured apply batches as resumable transfer chunks.
A durable chunk receipt binds chunk index, mutation offset, mutation count,
chunk hash, and planned after-hash set. Resume skips a committed chunk only
when the receipt matches the planned chunk window exactly.

Recorded posture:

- first attempt outcome: `interrupted-after-committed-chunk`
- committed chunk indexes: `0`, `1`
- resume mode: `receipt-prefix-skip-then-apply-missing-chunks`
- skipped chunk indexes: `0`, `1`
- applied chunk indexes after resume: `2`, `3`
- max mutation work count: `1`
- duplicate mutation work: `0`
- storage-boundary failures: `0`

## Generated negative coverage

The generated matrix contains one safe case and eight unsafe local support
cases. Unsafe cases suppress output and record deterministic decision hashes:

- stale committed chunk receipt blocks on `resume-skips-durable-chunks`;
- missing committed receipt blocks on `resume-skips-durable-chunks`;
- duplicate mutation counters block on `no-duplicate-mutation-work`;
- drifted resume storage blocks on
  `storage-boundary-cas-before-resume-mutations`;
- raw-value evidence blocks on `hash-only-chunk-transfer-evidence`;
- out-of-order transfer chunk evidence blocks on `ordered-transfer-chunks`;
- over-budget runtime evidence blocks on `runtime-resource-budget`; and
- premature passed status blocks on `correctness-gates-not-recorded`.

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
chunk resume accounting, storage-boundary ordering for resumed mutations, and
fail-closed stale or incomplete resume evidence behavior.

## Redaction posture

Chunk transfer evidence is hash-and-count-only. It stores sequence bounds,
counts, mutation-id hashes, resource-key hashes, storage hashes, chunk hashes,
receipt hashes, collection hashes, gate decision hashes, and blocker IDs. It
does not store row payloads, option values, post content, meta values, file
bytes, paths, live service configuration, bearer tokens, external URLs, or
private site values.

## Validation

Required validation commands for this slice:

- `node --check test/rpp-0753-apply-batch-sizing-v3.test.js`
- `node --test --test-name-pattern RPP-0753 test/rpp-0753-apply-batch-sizing-v3.test.js`
- `node --test --test-name-pattern RPP-0733 test/rpp-0733-apply-batch-sizing-v2.test.js`
- `node --test test/rpp-0713-apply-batch-sizing.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0753-apply-batch-sizing-v3.md`
- `git diff --check`

Observed focused proof result before commit:

- RPP-0753 syntax check: exit `0`
- RPP-0753 proof test: 2 pass, 0 fail
- Adjacent RPP-0733 apply batch sizing variant 2 test: 2 pass, 0 fail
- Adjacent RPP-0713 apply batch sizing test: 3 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean
