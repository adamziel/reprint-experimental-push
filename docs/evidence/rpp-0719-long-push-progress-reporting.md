# RPP-0719 long-push progress reporting evidence

Evidence for RPP-0719. This slice adds a focused storage/performance benchmark
for long-push operator progress reporting. The proof builds the existing
performance model, walks the large upload and plugin-install schedules, and
emits bounded operator updates from durable plan, receipt, staging, and commit
evidence.

## Progress behavior

The benchmark reports:

- benchmark id: `rpp-0719-long-push-progress-reporting`
- policy id: `rpp-0719-long-push-progress-reporting`
- variant: `1`
- event schema version: `1`
- reporting source: `durable-plan-and-receipt-evidence`
- operator-facing values: counts, bytes, percentages, and SHA-256 cursor hashes
- completion rule: `100-percent-only-after-final-durable-commit-evidence`
- large-site reporting budgets: at most `8` completed actions or `67108864`
  upload bytes between operator updates

Covered phases are plan scanning, preparation, transfer, file publish, database
batching, plugin metadata staging, group finalization, and atomic commit. Chunk
progress events carry hashed receipt, resume cursor, idempotency, plan, action,
and resource references. The progress stream does not include file bodies, row
values, raw resource keys, or absolute paths.

## Focused validation

Command:

- `node --test test/rpp-0719-long-push-progress-reporting.test.js`

Result:

- 3 tests, 3 ok, 0 failed

## Large-site budget run

Command:

- `node scripts/bench/rpp-0719-long-push-progress-reporting.js --profile=large-site`

Observed summary from this sandbox:

- `ok: true`
- profile: `large-site`
- duration: `11.86 ms` within the documented `5000 ms` budget
- heap used: `5349368 bytes` within the documented `268435456 bytes` budget
- operator progress events: `40`
- maximum completed-action gap between reports: `8`
- maximum upload-byte gap between reports: `67108864`
- modeled upload bytes: `1711276032`
- modeled upload chunks: `206`
- modeled database rows: `12620`
- modeled database batches: `27`

All benchmark gates reported `pass`: progress event schema, phase coverage,
monotonic counters, bounded operator update gaps, durable evidence backing,
hash-only redaction, completion after final durable evidence, and large-site
runtime budget.

## Limits

This is a storage/performance progress-reporting proof over the benchmark model.
It does not claim production UI rendering, production storage receipts,
production row batching, release-verifier carry-through, or production atomic
group commit throughput.
