# RPP-0723 transaction boundary policy variant 2 evidence

Evidence for RPP-0723. This slice is support-only and builds on the RPP-0703
guarded-executor transaction boundary policy. Final release remains **NO-GO**
without production storage receipts and external durability proof.

## Proof scope

The standalone proof test `test/rpp-0723-transaction-boundary-policy-v2.test.js`
runs the guarded executor benchmark with a bounded unit profile and projects a
variant 2 evidence object from the existing RPP-0703 policy report.

Variant 2 asserts:

- source policy: RPP-0703 policy id, variant 1, and evidence hash are retained;
- boundary order: chunk transfer transaction, file staging finalize boundary,
  and apply mutation transaction remain ordered;
- resume behavior: all chunks are skipped from exact durable receipts, no chunks
  or bytes are re-uploaded, and missing or mismatched receipts block skips;
- mutation accounting: apply opens only after transfer finalization, no mutation
  work is replayed before transfer finalization, and resume records zero
  duplicate mutation work;
- replay idempotency: repeated chunk replay produces receipt skips with zero
  duplicate receipt records, zero rewritten bytes, and zero mutation work;
- resource gates: chunk receipt counts, mutation counts, journal integrity, and
  redaction evidence remain bounded; and
- runtime gates: the report includes conservative duration and heap budgets, and
  an intentionally impossible heap budget fails only the runtime gate while the
  transaction boundary accounting still passes.

## Support-only release posture

The proof keeps the guarded executor report in lab evidence mode:

- production throughput remains `not-claimed`;
- rollout speed claims remain blocked;
- production storage receipts are still not measured;
- production batched row compare-and-swap execution is still not measured; and
- production atomic group commit durability is still not measured.

This evidence does not claim production storage durability, database rollback,
external object-store receipt durability, or production row batch throughput.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0723-transaction-boundary-policy-v2.test.js`
- `node --test --test-name-pattern RPP-0723 test/rpp-0723-transaction-boundary-policy-v2.test.js`
- `node --test --test-name-pattern RPP-0703 test/guarded-executor-benchmark.test.js`
- `node scripts/bench/guarded-executor-benchmark.js --profile=unit --file-bytes=1048576 --chunk-size-bytes=262144 --row-count=8 --row-payload-bytes=64 --replay-attempts-per-chunk=2 --max-duration-ms=10000 --max-heap-used-bytes=268435456`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0723-transaction-boundary-policy-v2.md`
- `git diff --check`

Observed result after local validation:

- RPP-0723 proof test: 2 pass, 0 fail
- Adjacent RPP-0703 guarded executor coverage: 1 pass, 0 fail
- Bounded guarded executor benchmark: `productionThroughput` remained
  `not-claimed`, runtime budget passed, and rollout speed claims stayed blocked
- Scoped artifact redaction scan: `ok: true`, 0 rejected files
- Diff whitespace check: clean

## Redaction posture

The variant 2 proof projection is hash-and-count-only. It stores policy hashes,
receipt counts, byte counts, sequence numbers, runtime budgets, gate statuses,
and production blocker identifiers. It does not store row payloads, raw file
content, plugin paths, option values, post content, credentials, cookies, or
live URLs.
