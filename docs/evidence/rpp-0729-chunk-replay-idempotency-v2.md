# RPP-0729 chunk replay idempotency variant 2 evidence

Evidence for RPP-0729. This slice is support-only and builds on the RPP-0709
chunk replay idempotency proof. Final release remains **NO-GO** without
production-backed storage receipts, production row batching, production atomic
group commit evidence, and release-verifier carry-through.

## Proof scope

The standalone proof test
`test/rpp-0729-chunk-replay-idempotency-v2.test.js` exercises the existing
focused chunk replay benchmark and supplemental replay module.

Variant 2 asserts:

- exact duplicate replay returns the existing durable chunk receipt;
- duplicate replay writes 0 chunk bytes, creates 0 duplicate receipt records,
  and performs 0 duplicate mutation work;
- missing receipts, mismatched digests, stale plan scope, stale resource scope,
  stale byte ranges, and canonical-visible receipt conflicts fail closed;
- the `guardedLarge` focused replay run finishes inside its documented runtime
  and heap budgets; and
- the public RPP-0729 projection stores counts and hashes only, not raw receipt
  keys, idempotency keys, paths, payloads, credentials, cookies, or live URLs.

## Large-site replay run

Focused large-site command:

```sh
node scripts/bench/guarded-executor-benchmark.js --chunk-replay-idempotency-only --profile=guardedLarge > /tmp/rpp-0729-chunk-replay-idempotency-v2.json
```

Observed summary:

- profile: `guardedLarge`
- file bytes: `402653184`
- chunk size: `8388608`
- chunks: `48`
- replay attempts: `96` (`2` per chunk)
- existing receipt returns: `96`
- duplicate receipt records written: `0`
- bytes rewritten during replay: `0`
- duplicate mutation work: `0`
- duration: `2765.69 ms` within the documented `120000 ms` budget
- heap used: `6053792 bytes` within the documented `536870912 bytes` budget
- gates: `durable-chunk-receipts`, `chunk-hash-verification`,
  `chunk-replay-idempotency`, `no-duplicate-mutation-work`, and
  `large-site-runtime-budget` all reported `pass`
- production throughput: `not-claimed`
- release readiness: `NO-GO-without-live-production-proof`

## Support-only release posture

The variant 2 proof keeps this lane out of release readiness:

- `supportOnly: true`;
- `productionBacked: false`;
- production throughput is `not-claimed`;
- production storage receipts are not measured;
- production row batch execution is not measured;
- production atomic group commit is not measured;
- release-verifier carry-through is not claimed; and
- final release status and integration recommendation remain `NO-GO`.

This evidence does not claim production storage durability, production
throughput, database transaction behavior, atomic group production behavior,
release approval, or live-site replay safety.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0729-chunk-replay-idempotency-v2.test.js`
- `node --test --test-name-pattern RPP-0729 test/rpp-0729-chunk-replay-idempotency-v2.test.js`
- `node --test test/chunk-replay-idempotency.test.js`
- `node --test test/guarded-executor-benchmark.test.js test/performance-model.test.js`
- `node scripts/bench/guarded-executor-benchmark.js --chunk-replay-idempotency-only --profile=guardedLarge > /tmp/rpp-0729-chunk-replay-idempotency-v2.json`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0729-chunk-replay-idempotency-v2.md`
- `git diff --check`
- `git diff --cached --check`

Observed result after local validation:

- RPP-0729 proof test: 2 pass, 0 fail
- Adjacent chunk replay idempotency tests: 4 pass, 0 fail
- Adjacent guarded executor and performance-model tests: 19 pass, 0 fail
- Focused large-site replay benchmark: `ok: true`
- Scoped artifact redaction scan: `ok: true`, 0 rejected files
- Diff whitespace checks: clean

## Redaction posture

The variant 2 public proof projection is hash-and-count-only. It stores replay
counts, duplicate-work counters, fail-closed booleans, runtime budgets, gate
statuses, blocker identifiers, and hashes of replay decisions. It does not store
raw receipt keys, idempotency keys, logical paths, absolute paths, staged file
payloads, option values, post content, credentials, cookies, or live URLs.
