# RPP-0709 chunk replay idempotency

Date: 2026-05-30
Slice: `RPP-0709` / storage-performance / variant 1
Status: evidence captured for the lab guarded executor; release remains NO-GO
without live production proof.

## Implementation summary

`scripts/bench/guarded-executor-benchmark.js` now records a first-class
`evidence.guardedTransfer.replayIdempotency` proof. The proof models the lost
response/client retry case after a durable chunk receipt already exists.
Replayed chunks are answered from the exact plan-scoped receipt only when the
receipt matches all replay cursor fields:

- `planId`
- `resourceKey`
- `localResourceHash`
- `chunkIndex`
- `offsetBytes`
- `sizeBytes`
- `chunkDigest`
- `receiptKey`
- `idempotencyKey`

The proof fails closed when the receipt is missing, belongs to another plan or
resource, has a different byte range, or carries a mismatched digest. Accepted
replays return the existing receipt and record zero duplicate chunk bytes, zero
new duplicate receipt records, and zero duplicate mutation work.

The integration also keeps a supplemental focused module in
`src/chunk-replay-idempotency.js`. That module exercises the same replay
contract without depending on the full guarded benchmark: exact replay returns
the durable receipt, missing receipt returns `upload-required`, a reused
idempotency key with different chunk bytes blocks as `idempotency-key-conflict`,
and budget evidence fails closed when the documented replay budget is exceeded.

The guarded benchmark also reports conservative runtime budgets under `runtime`
and `resources.runtimeBudget`. Production throughput remains blocked unless the
idempotency proof and runtime budget evidence are present, and the existing
production storage, row batch, and atomic commit gaps remain blockers.

## Focused large-site chunk replay run

Command:

```sh
node scripts/bench/guarded-executor-benchmark.js --chunk-replay-idempotency-only --profile=guardedLarge > /tmp/rpp-0709-chunk-replay-idempotency.json
```

Observed summary:

- profile: `guardedLarge`
- file bytes: `402653184`
- chunk size: `8388608`
- chunks: `48`
- replay attempts: `96` (`2` per chunk)
- idempotent skips: `96`
- duplicate receipt records written: `0`
- bytes rewritten during replay: `0`
- duplicate mutation work: `0`
- duration: `2541.86 ms` within the documented `120000 ms` budget
- heap used: `6100624 bytes` within the documented `536870912 bytes` budget
- gates: `durable-chunk-receipts`, `chunk-hash-verification`,
  `chunk-replay-idempotency`, `no-duplicate-mutation-work`, and
  `large-site-runtime-budget` all reported `pass`
- production throughput: `not-claimed`

## Adjacent full guarded executor run

Command:

```sh
node scripts/bench/guarded-executor-benchmark.js --profile=guardedLarge > /tmp/guarded-large-full-rpp0709.json
```

Observed summary:

- profile: `guardedLarge`
- file bytes: `402653184`
- chunks: `48`
- row count: `96`
- mutations: `106`
- replay attempts: `96`
- idempotent skips: `96`
- bytes rewritten during replay: `0`
- duplicate mutation work: `0`
- duration: `14555.52 ms` within the documented `120000 ms` budget
- heap used: `17736512 bytes` within the documented `536870912 bytes` budget
- rollout safety gates: `8` passed, `3` blocked, `0` failed
- remaining production blockers: production storage receipts, row batch
  executor, and atomic group commit are still not measured

## Validation

Focused validation performed while preparing this evidence:

```sh
node --check scripts/bench/guarded-executor-benchmark.js
node --check src/chunk-replay-idempotency.js
node --check test/chunk-replay-idempotency.test.js
node --test test/chunk-replay-idempotency.test.js
node --test test/guarded-executor-benchmark.test.js
node scripts/bench/guarded-executor-benchmark.js --chunk-replay-idempotency-only --profile=guardedLarge > /tmp/rpp-0709-chunk-replay-idempotency.json
node scripts/bench/guarded-executor-benchmark.js --profile=guardedLarge > /tmp/guarded-large-full-rpp0709.json
```

The supplemental focused module reports 4 passing tests. The guarded executor
focused pattern reports the RPP-0709 replay idempotency and RPP-0710 parallel
snapshot hashing checks passing together.

Additional local validation before commit:

```sh
node --check scripts/bench/guarded-executor-benchmark.js
node --check test/guarded-executor-benchmark.test.js
node --test test/guarded-executor-benchmark.test.js test/performance-model.test.js
node scripts/release/checklist-completion-lint.mjs
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0709-chunk-replay-idempotency.md docs/reprint-push-completion-checklist.md
git diff --check
```

Results: syntax checks passed, 18 adjacent guarded executor/performance-model
subtests passed, checklist lint returned `ok: true`, the changed docs redaction
scan returned `ok: true`, and whitespace diff check passed.
